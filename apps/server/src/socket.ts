// Lógica de Socket.IO: salas, chat, reenvío de señales WebRTC y SFU de Cloudflare.
import { randomUUID } from 'node:crypto';
import type { Server, Socket } from 'socket.io';
import {
  MAX_MESSAGE_LENGTH,
  MAX_NAME_LENGTH,
  ROOM_CODE_LENGTH,
  SFU_LAYERS,
  type ClientToServerEvents,
  type JoinedData,
  type Participant,
  type ServerToClientEvents,
  type SfuLayer,
} from '@lazo/shared';
import {
  addMessage,
  addParticipant,
  createRoom,
  getRoom,
  hasHost,
  listParticipants,
  removeParticipant,
  type Room,
} from './rooms.js';
import {
  changeLayer,
  closeTracks,
  newSession,
  publishTracks,
  pullTracks,
  renegotiate,
  sfuConfigured,
} from './sfu.js';
import { getIceConfig } from './turn.js';

type IO = Server<ClientToServerEvents, ServerToClientEvents>;
type DuoSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

// Límite de frecuencia del chat: máximo 5 mensajes cada 5 segundos por persona
const CHAT_WINDOW_MS = 5000;
const CHAT_MAX_IN_WINDOW = 5;

/** Limpia y valida el nombre. Devuelve null si no es válido. */
function cleanName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.trim();
  if (name.length === 0 || name.length > MAX_NAME_LENGTH) return null;
  return name;
}

function validCallId(id: unknown): id is string {
  return typeof id === 'string' && id.length > 0 && id.length <= 64;
}

// Límite de frecuencia del SFU: cada operación es una llamada a Cloudflare
const SFU_WINDOW_MS = 10_000;
const SFU_MAX_IN_WINDOW = 15;

/** ¿Es una descripción SDP del tipo esperado y de tamaño razonable? */
function validSdp(x: unknown, type: 'offer' | 'answer'): x is RTCSessionDescriptionInit {
  const d = x as RTCSessionDescriptionInit | null;
  return !!d && d.type === type && typeof d.sdp === 'string' && d.sdp.length > 0 && d.sdp.length < 60_000;
}

const validMid = (x: unknown): x is string => typeof x === 'string' && /^[\w-]{1,16}$/.test(x);
const validLayer = (x: unknown): x is SfuLayer => SFU_LAYERS.includes(x as SfuLayer);

/** Termina la publicación del anfitrión en el SFU y la de todos los que la recibían. */
function unpublish(io: IO, room: Room): void {
  const pub = room.publication;
  if (!pub) return;
  room.publication = null;
  void closeTracks(
    pub.sessionId,
    pub.tracks.map((t) => t.mid),
  );
  for (const id of [...room.subscriptions.keys()]) closeSubscription(room, id);
  if (pub.live) io.to(room.code).emit('sfu:unpublished', { pubId: pub.id });
}

/** Cierra lo que un espectador recibía del SFU. */
function closeSubscription(room: Room, socketId: string): void {
  const sub = room.subscriptions.get(socketId);
  if (!sub) return;
  room.subscriptions.delete(socketId);
  void closeTracks(sub.sessionId, sub.mids);
}

export function registerSocketHandlers(io: IO) {
  io.on('connection', (socket: DuoSocket) => {
    // Sala actual de este socket (solo puede estar en una)
    let currentRoom: Room | null = null;
    let me: Participant | null = null;
    let chatTimes: number[] = [];
    let sfuTimes: number[] = [];
    let sfuBusy = false; // una operación de publicar/recibir a la vez por persona

    /** ¿Puede hacer otra operación del SFU? (límite de frecuencia) */
    const sfuAllowed = () => {
      const now = Date.now();
      sfuTimes = sfuTimes.filter((t) => now - t < SFU_WINDOW_MS);
      if (sfuTimes.length >= SFU_MAX_IN_WINDOW) return false;
      sfuTimes.push(now);
      return true;
    };

    /** Avisa a todos en la sala quién está dentro. */
    const emitPresence = (room: Room) => {
      io.to(room.code).emit('presence', {
        code: room.code,
        participants: listParticipants(room),
      });
    };

    const joinedData = (room: Room, p: Participant): JoinedData => ({
      code: room.code,
      me: p,
      participants: listParticipants(room),
      history: room.history,
    });

    const leave = () => {
      if (!currentRoom) return;
      const room = currentRoom;
      // Cerrar lo que tuviera en el SFU (si era el anfitrión, termina su publicación)
      if (me?.role === 'host') unpublish(io, room);
      closeSubscription(room, socket.id);
      socket.leave(room.code);
      removeParticipant(room, socket.id);
      currentRoom = null;
      me = null;
      emitPresence(room); // si la sala ya no existe, simplemente nadie lo recibe
    };

    /** Id del anfitrión de mi sala (o null si no hay). */
    const hostId = () =>
      currentRoom ? listParticipants(currentRoom).find((p) => p.role === 'host')?.id : undefined;

    /** ¿Ese id es un invitado de MI sala? (para no reenviar a cualquiera) */
    const isGuestInMyRoom = (id: unknown): id is string =>
      typeof id === 'string' && currentRoom?.participants.get(id)?.role === 'guest';

    socket.on('room:create', (payload, ack) => {
      if (typeof ack !== 'function') return;
      const name = cleanName(payload?.name);
      if (!name) return ack({ ok: false, error: `Nombre inválido (1 a ${MAX_NAME_LENGTH} caracteres)` });
      leave();
      const host: Participant = { id: socket.id, name, role: 'host' };
      const room = createRoom(host);
      currentRoom = room;
      me = host;
      socket.join(room.code);
      ack({ ok: true, data: joinedData(room, host) });
      emitPresence(room);
    });

    socket.on('room:join', (payload, ack) => {
      if (typeof ack !== 'function') return;
      const name = cleanName(payload?.name);
      if (!name) return ack({ ok: false, error: `Nombre inválido (1 a ${MAX_NAME_LENGTH} caracteres)` });
      const code = typeof payload?.code === 'string' ? payload.code.trim().toUpperCase() : '';
      if (code.length !== ROOM_CODE_LENGTH) return ack({ ok: false, error: 'Código inválido' });
      const room = getRoom(code);
      if (!room) return ack({ ok: false, error: 'La sala no existe' });
      if (currentRoom === room) return ack({ ok: true, data: joinedData(room, me!) });
      leave();
      // Normalmente quien se une es invitado. Pero si el anfitrión se fue
      // (p. ej. se le cortó la conexión) y vuelve a entrar, recupera el rol.
      const role = hasHost(room) ? 'guest' : 'host';
      const p: Participant = { id: socket.id, name, role };
      const error = addParticipant(room, p);
      if (error) return ack({ ok: false, error });
      currentRoom = room;
      me = p;
      socket.join(room.code);
      ack({ ok: true, data: joinedData(room, p) });
      emitPresence(room);
    });

    socket.on('room:leave', leave);

    socket.on('chat:message', (payload, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      if (!currentRoom || !me) return reply({ ok: false, error: 'No estás en una sala' });
      const text = typeof payload?.text === 'string' ? payload.text.trim() : '';
      if (!text) return reply({ ok: false, error: 'Mensaje vacío' });
      if (text.length > MAX_MESSAGE_LENGTH)
        return reply({ ok: false, error: `Máximo ${MAX_MESSAGE_LENGTH} caracteres` });

      // Límite de frecuencia simple
      const now = Date.now();
      chatTimes = chatTimes.filter((t) => now - t < CHAT_WINDOW_MS);
      if (chatTimes.length >= CHAT_MAX_IN_WINDOW)
        return reply({ ok: false, error: 'Vas muy rápido, espera un momento' });
      chatTimes.push(now);

      const msg = { id: randomUUID(), fromId: me.id, name: me.name, text, at: now };
      addMessage(currentRoom, msg);
      io.to(currentRoom.code).emit('chat:message', msg);
      reply({ ok: true });
    });

    // ---- Señalización WebRTC ----
    // El anfitrión tiene una conexión con CADA invitado:
    //   anfitrión -> un invitado concreto (campo "to")
    //   invitado  -> siempre al anfitrión
    // (El servidor nunca ve el video, solo estos mensajes de texto para conectar.)
    socket.on('webrtc:offer', (p) => {
      if (me?.role !== 'host' || !validCallId(p?.callId) || !p.sdp) return; // solo el anfitrión ofrece
      if (!isGuestInMyRoom(p.to)) return;
      io.to(p.to).emit('webrtc:offer', { callId: p.callId, sdp: p.sdp, fromId: socket.id });
    });
    socket.on('webrtc:answer', (p) => {
      const host = hostId();
      if (me?.role !== 'guest' || !host || !validCallId(p?.callId) || !p.sdp) return;
      io.to(host).emit('webrtc:answer', { callId: p.callId, sdp: p.sdp, fromId: socket.id });
    });
    socket.on('webrtc:ice', (p) => {
      if (!validCallId(p?.callId) || !p.candidate) return;
      const target = me?.role === 'host' ? (isGuestInMyRoom(p.to) ? p.to : null) : hostId();
      if (!target) return;
      io.to(target).emit('webrtc:ice', { callId: p.callId, candidate: p.candidate, fromId: socket.id });
    });
    socket.on('webrtc:request', (p) => {
      const host = hostId();
      if (me?.role !== 'guest' || !host || !currentRoom) return;
      // Si el anfitrión ya publica por el SFU, el invitado recibe de ahí (sin molestar al anfitrión).
      // Con p2p = true (el SFU le falló a este invitado) se pide la conexión directa al anfitrión.
      const pub = currentRoom.publication;
      if (pub?.live && p?.p2p !== true) return void socket.emit('sfu:published', { pubId: pub.id });
      io.to(host).emit('webrtc:request', { fromId: socket.id, p2p: p?.p2p === true });
    });
    socket.on('webrtc:config', (ack) => {
      if (typeof ack !== 'function') return;
      // Solo quien está en una sala recibe credenciales TURN (para que nadie las use gratis)
      if (!currentRoom) return ack({ ok: false, error: 'No estás en una sala' });
      void getIceConfig().then((data) => ack({ ok: true, data: { ...data, sfu: sfuConfigured() } }));
    });
    socket.on('webrtc:stop', () => {
      // El anfitrión dejó de compartir: avisar a todos los invitados
      if (me?.role !== 'host' || !currentRoom) return;
      unpublish(io, currentRoom);
      socket.to(currentRoom.code).emit('webrtc:stop', { fromId: socket.id });
    });

    // ---- SFU de Cloudflare ----
    // El servidor guarda qué sesión del SFU es de quién: nadie puede tocar la sesión de otro.
    // Solo el anfitrión publica; solo los invitados de la misma sala reciben.

    // ANFITRIÓN: publica su audio y video (su oferta -> respuesta del SFU)
    socket.on('sfu:publish', async (p, ack) => {
      if (typeof ack !== 'function') return;
      const room = currentRoom;
      if (!sfuConfigured()) return ack({ ok: false, error: 'El SFU no está configurado' });
      if (me?.role !== 'host' || !room) return ack({ ok: false, error: 'Solo el anfitrión puede publicar' });
      const tracks = Array.isArray(p?.tracks) ? p.tracks : [];
      const kinds = tracks.map((t) => t?.kind);
      if (
        !validSdp(p?.sdp, 'offer') ||
        tracks.length < 1 ||
        tracks.length > 2 ||
        !tracks.every((t) => validMid(t?.mid) && (t.kind === 'audio' || t.kind === 'video')) ||
        new Set(kinds).size !== kinds.length // como mucho un audio y un video
      ) {
        return ack({ ok: false, error: 'Datos inválidos' });
      }
      if (sfuBusy) return ack({ ok: false, error: 'Espera un momento' });
      if (!sfuAllowed()) return ack({ ok: false, error: 'Demasiados intentos, espera un momento' });

      sfuBusy = true;
      unpublish(io, room); // si ya publicaba algo, se cierra primero
      // Nombres de pista fijos: los pone el servidor, no el navegador
      const named = tracks.map((t) => ({ mid: t.mid, kind: t.kind, trackName: t.kind }));
      let sessionId: string | null = null;
      try {
        sessionId = await newSession();
        const answer = await publishTracks(sessionId, p.sdp, named);
        // Mientras esperábamos a Cloudflare pudo irse de la sala o dejar de ser anfitrión
        if (currentRoom !== room || me?.role !== 'host') throw new Error('el anfitrión ya no está');
        const pubId = randomUUID();
        room.publication = { id: pubId, sessionId, tracks: named, live: false };
        ack({ ok: true, data: { pubId, sdp: answer } });
      } catch (err) {
        console.error('[sfu] no se pudo publicar:', (err as Error).message);
        if (sessionId)
          void closeTracks(
            sessionId,
            named.map((t) => t.mid),
          );
        ack({ ok: false, error: 'No se pudo publicar en el SFU' });
      } finally {
        sfuBusy = false;
      }
    });

    // ANFITRIÓN: su conexión con el SFU ya funciona -> los invitados pueden recibir
    socket.on('sfu:live', (p) => {
      const room = currentRoom;
      const pub = room?.publication;
      if (me?.role !== 'host' || !room || !pub || pub.id !== p?.pubId || pub.live) return;
      pub.live = true;
      socket.to(room.code).emit('sfu:published', { pubId: pub.id });
    });

    // ANFITRIÓN: deja de publicar por el SFU
    socket.on('sfu:unpublish', () => {
      if (me?.role !== 'host' || !currentRoom) return;
      unpublish(io, currentRoom);
    });

    // INVITADO: pide recibir la publicación actual (-> oferta del SFU)
    socket.on('sfu:subscribe', async (p, ack) => {
      if (typeof ack !== 'function') return;
      const room = currentRoom;
      if (me?.role !== 'guest' || !room) return ack({ ok: false, error: 'Solo los invitados reciben' });
      const pub = room.publication;
      if (!pub?.live) return ack({ ok: false, error: 'El anfitrión no está publicando' });
      const layer = validLayer(p?.layer) ? p.layer : 'f';
      if (sfuBusy) return ack({ ok: false, error: 'Espera un momento' });
      if (!sfuAllowed()) return ack({ ok: false, error: 'Demasiados intentos, espera un momento' });

      sfuBusy = true;
      closeSubscription(room, socket.id); // si ya recibía algo, se cierra primero
      let sessionId: string | null = null;
      let mids: string[] = [];
      try {
        sessionId = await newSession();
        const r = await pullTracks(sessionId, pub.sessionId, pub.tracks, layer);
        mids = r.tracks.map((t) => t.mid);
        // Mientras esperábamos pudo irse, o el anfitrión pudo dejar de publicar
        if (currentRoom !== room || me?.role !== 'guest' || room.publication !== pub) {
          throw new Error('la publicación o el invitado ya no están');
        }
        const tracks = r.tracks.map((t) => ({
          mid: t.mid,
          kind: pub.tracks.find((x) => x.trackName === t.trackName)?.kind ?? 'video',
        }));
        room.subscriptions.set(socket.id, {
          pubId: pub.id,
          sessionId,
          mids,
          videoMid: tracks.find((t) => t.kind === 'video')?.mid ?? null,
          layer,
          pending: true,
          busy: false,
        });
        ack({ ok: true, data: { pubId: pub.id, sdp: r.offer, tracks } });
      } catch (err) {
        console.error('[sfu] no se pudo recibir:', (err as Error).message);
        if (sessionId) void closeTracks(sessionId, mids);
        ack({ ok: false, error: 'No se pudo conectar con el SFU' });
      } finally {
        sfuBusy = false;
      }
    });

    // INVITADO: contesta la oferta del SFU
    socket.on('sfu:answer', async (p, ack) => {
      if (typeof ack !== 'function') return;
      const room = currentRoom;
      const sub = room?.subscriptions.get(socket.id);
      if (!room || !sub || sub.pubId !== p?.pubId || !sub.pending) {
        return ack({ ok: false, error: 'No hay nada que contestar' });
      }
      if (!validSdp(p.sdp, 'answer')) return ack({ ok: false, error: 'Datos inválidos' });
      if (!sfuAllowed()) return ack({ ok: false, error: 'Demasiados intentos, espera un momento' });
      sub.pending = false; // solo se contesta una vez
      try {
        await renegotiate(sub.sessionId, p.sdp);
        ack({ ok: true });
      } catch (err) {
        console.error('[sfu] no se aceptó la respuesta:', (err as Error).message);
        closeSubscription(room, socket.id);
        ack({ ok: false, error: 'No se pudo conectar con el SFU' });
      }
    });

    // INVITADO: cambia la capa de video que recibe (f / h / q)
    socket.on('sfu:layer', async (p, ack) => {
      if (typeof ack !== 'function') return;
      const room = currentRoom;
      const sub = room?.subscriptions.get(socket.id);
      const pub = room?.publication;
      const video = pub?.tracks.find((t) => t.kind === 'video');
      if (!room || !sub || !pub || sub.pubId !== pub.id || !sub.videoMid || !video) {
        return ack({ ok: false, error: 'No estás recibiendo video del SFU' });
      }
      if (!validLayer(p?.layer)) return ack({ ok: false, error: 'Capa inválida' });
      if (sub.pending || sub.busy) return ack({ ok: false, error: 'Espera un momento' });
      if (sub.layer === p.layer) return ack({ ok: true });
      if (!sfuAllowed()) return ack({ ok: false, error: 'Demasiados intentos, espera un momento' });
      sub.busy = true;
      try {
        await changeLayer(sub.sessionId, sub.videoMid, pub.sessionId, video.trackName, p.layer);
        sub.layer = p.layer;
        ack({ ok: true });
      } catch (err) {
        console.error('[sfu] no se pudo cambiar la capa:', (err as Error).message);
        ack({ ok: false, error: 'No se pudo cambiar la calidad' });
      } finally {
        sub.busy = false;
      }
    });

    socket.on('disconnect', leave);
  });
}
