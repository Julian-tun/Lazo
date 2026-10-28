// Lógica de Socket.IO: salas, chat y reenvío de señales WebRTC.
import { randomUUID } from 'node:crypto';
import type { Server, Socket } from 'socket.io';
import {
  MAX_MESSAGE_LENGTH,
  MAX_NAME_LENGTH,
  ROOM_CODE_LENGTH,
  type ClientToServerEvents,
  type JoinedData,
  type Participant,
  type ServerToClientEvents,
} from '@duo/shared';
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

export function registerSocketHandlers(io: IO) {
  io.on('connection', (socket: DuoSocket) => {
    // Sala actual de este socket (solo puede estar en una)
    let currentRoom: Room | null = null;
    let me: Participant | null = null;
    let chatTimes: number[] = [];

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
      socket.leave(room.code);
      removeParticipant(room, socket.id);
      currentRoom = null;
      me = null;
      emitPresence(room); // si la sala ya no existe, simplemente nadie lo recibe
    };

    /** Id del anfitrión de mi sala (o null si no hay). */
    const hostId = () => (currentRoom ? listParticipants(currentRoom).find((p) => p.role === 'host')?.id : undefined);

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
    socket.on('webrtc:request', () => {
      const host = hostId();
      if (me?.role !== 'guest' || !host) return;
      io.to(host).emit('webrtc:request', { fromId: socket.id });
    });
    socket.on('webrtc:config', (ack) => {
      if (typeof ack !== 'function') return;
      // Solo quien está en una sala recibe credenciales TURN (para que nadie las use gratis)
      if (!currentRoom) return ack({ ok: false, error: 'No estás en una sala' });
      void getIceConfig().then((data) => ack({ ok: true, data }));
    });
    socket.on('webrtc:stop', () => {
      // El anfitrión dejó de compartir: avisar a todos los invitados
      if (me?.role !== 'host' || !currentRoom) return;
      socket.to(currentRoom.code).emit('webrtc:stop', { fromId: socket.id });
    });

    socket.on('disconnect', leave);
  });
}
