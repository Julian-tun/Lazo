// Visor del INVITADO: recibe por WebRTC la pestaña que comparte el anfitrión.
// Dos caminos:
//   - SFU: el video llega desde Cloudflare (cuando el anfitrión publica ahí).
//   - P2P: conexión directa con el anfitrión (si no hay SFU o si el SFU falla).
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { SfuLayer } from '@lazo/shared';
import { subscribeFromSfu, type SfuSubscriber } from '../../lib/sfu';
import { AutoLayer, judge, readRecvSample, type RecvSample, smoothPlayback } from '../../lib/sfuQuality';
import { ACK_TIMEOUT_MS, socket } from '../../lib/socket';
import { createPeerLink, getIceConfig, opusStereo, type PeerLink } from '../../lib/webrtc';

interface Props {
  meId: string;
  hostId: string | null; // null si el anfitrión no está en la sala
  // Capa extra sobre el video (p. ej. avisos de chat). Recibe si estamos en pantalla completa.
  overlay?: (isFullscreen: boolean) => ReactNode;
}

type Status = 'waiting' | 'connecting' | 'live' | 'failed';
type Choice = 'auto' | SfuLayer; // calidad elegida por el espectador

const LAYER_LABEL: Record<SfuLayer, string> = { f: 'Alta', h: 'Media', q: 'Baja' };

/** Pide al servidor otra capa del SFU. Devuelve true si se aceptó. */
async function askLayer(layer: SfuLayer): Promise<boolean> {
  try {
    const r = await socket.timeout(ACK_TIMEOUT_MS).emitWithAck('sfu:layer', { layer });
    return r.ok;
  } catch {
    return false;
  }
}

export function GuestViewer({ meId, hostId, overlay }: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const linkRef = useRef<PeerLink | null>(null); // conexión directa (P2P)
  const sfuRef = useRef<SfuSubscriber | null>(null); // conexión con Cloudflare (SFU)
  // Capa del SFU que pedimos: f = completa (la mejor), h = mitad, q = cuarto
  const layerRef = useRef<SfuLayer>('f');
  const [status, setStatus] = useState<Status>('waiting');
  // Por dónde llega el video ahora: Cloudflare (SFU) o directo del anfitrión (P2P)
  const [via, setVia] = useState<'sfu' | 'p2p' | null>(null);
  // Capa que recibimos y calidad elegida (Auto = la decide la app según tu internet)
  const [layer, setLayer] = useState<SfuLayer>('f');
  const [choice, setChoice] = useState<Choice>('auto');
  const choiceRef = useRef<Choice>('auto');
  // Lo que llega ahora (alto y cuadros por segundo), para mostrarlo en el selector
  const [recv, setRecv] = useState<{ height: number | null; fps: number } | null>(null);
  // Arranca silenciado: los navegadores solo dejan reproducir solo si está en silencio
  const [muted, setMuted] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [qualityOpen, setQualityOpen] = useState(false); // ¿se ven las opciones de calidad?
  const autoRestartRef = useRef(false); // true = se acaba de elegir "Auto": el automático empieza de cero
  const qualityRef = useRef<HTMLDivElement>(null); // botón ⚙ + sus opciones

  // Opciones de calidad abiertas: tocar en otra parte del VIDEO las cierra
  // (tocar el chat o la barra de arriba no las cierra)
  useEffect(() => {
    if (!qualityOpen) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (boxRef.current?.contains(t) && !qualityRef.current?.contains(t)) setQualityOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [qualityOpen]);

  // Saber si estamos en pantalla completa, y salir solos al girar a vertical
  // (así se ve el chat para contestar).
  useEffect(() => {
    const onFsChange = () => setIsFullscreen(document.fullscreenElement === boxRef.current);
    const portrait = window.matchMedia('(orientation: portrait)');
    const onRotate = () => {
      if (portrait.matches && document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    };
    document.addEventListener('fullscreenchange', onFsChange);
    portrait.addEventListener('change', onRotate);
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange);
      portrait.removeEventListener('change', onRotate);
    };
  }, []);

  useEffect(() => {
    const closeP2P = () => {
      linkRef.current?.close();
      linkRef.current = null;
    };
    const closeSfu = () => {
      sfuRef.current?.close();
      sfuRef.current = null;
    };
    const reset = () => {
      closeP2P();
      closeSfu();
      if (videoRef.current) videoRef.current.srcObject = null;
      setStatus('waiting');
      setVia(null);
    };
    /** Pone el stream en el <video> (si no estaba ya). */
    const show = (remote: MediaStream) => {
      const video = videoRef.current;
      if (video && video.srcObject !== remote) {
        video.srcObject = remote;
        video.play().catch(() => {}); // si falla, el usuario puede tocar "Activar sonido"
      }
    };

    // Cada intento nuevo (SFU u oferta P2P) invalida a los anteriores que sigan en curso
    let attempt = 0;
    // Publicación del SFU que estamos conectando ahora (para no repetirla si llega dos veces el aviso)
    let pendingPub: string | null = null;
    // Oferta más reciente: si llegan dos seguidas, gana la última
    let latestCallId: string | null = null;
    // Candidatos ICE que llegan mientras aún preparamos la conexión
    let earlyIce: { callId: string; candidate: RTCIceCandidateInit }[] = [];

    // ---- SFU: el anfitrión publica en Cloudflare -> recibimos de ahí ----
    const onSfuPublished = async ({ pubId }: { pubId: string }) => {
      if (pendingPub === pubId) return; // ya lo estamos conectando
      if (sfuRef.current?.pubId === pubId && sfuRef.current.pc.connectionState === 'connected') return;
      const my = ++attempt;
      pendingPub = pubId;
      latestCallId = null; // ofertas P2P anteriores ya no valen
      setStatus('connecting');
      closeSfu();
      closeP2P();
      try {
        const { iceServers } = await getIceConfig();
        if (my !== attempt) return;
        const sub = await subscribeFromSfu(layerRef.current, iceServers, (state) => {
          if (sfuRef.current !== sub) return;
          if (state === 'connected') setStatus('live');
          else if (state === 'disconnected') setStatus('connecting');
          else if (state === 'failed') {
            // Se cayó la conexión con Cloudflare: pedimos conexión directa al anfitrión
            console.warn('[guest] se cayó la conexión con el SFU; pido conexión directa');
            closeSfu();
            setStatus('connecting');
            socket.emit('webrtc:request', { p2p: true });
          }
        });
        if (my !== attempt) return sub.close();
        sfuRef.current = sub;
        show(sub.stream);
        setVia('sfu');
        setStatus('live');
      } catch (err) {
        if (my !== attempt) return;
        console.warn('[guest] no se pudo recibir del SFU; pido conexión directa', err);
        socket.emit('webrtc:request', { p2p: true });
      } finally {
        if (my === attempt) pendingPub = null;
      }
    };
    const onSfuUnpublished = ({ pubId }: { pubId: string }) => {
      if (sfuRef.current?.pubId !== pubId && pendingPub !== pubId) return;
      attempt++; // cancela una conexión al SFU que siga en curso
      pendingPub = null;
      closeSfu();
      // Si no hay conexión directa, toca esperar (el anfitrión vuelve a compartir o pasa a P2P)
      if (!linkRef.current) {
        if (videoRef.current) videoRef.current.srcObject = null;
        setStatus('waiting');
      }
    };

    // ---- P2P: el anfitrión nos manda una oferta: creamos la conexión y respondemos ----
    const onOffer = async ({ callId, sdp }: { callId: string; sdp: RTCSessionDescriptionInit }) => {
      const my = ++attempt; // la conexión directa reemplaza a la del SFU
      pendingPub = null;
      latestCallId = callId;
      setStatus('connecting');
      const { iceServers } = await getIceConfig(); // STUN + TURN de respaldo (si hay)
      if (latestCallId !== callId || my !== attempt) return; // mientras tanto llegó otra cosa

      closeSfu();
      closeP2P();
      const link = createPeerLink(callId, iceServers, (candidate) =>
        socket.emit('webrtc:ice', { callId, candidate }),
      );
      linkRef.current = link;
      for (const e of earlyIce) if (e.callId === callId) void link.addIce(e.candidate);
      earlyIce = [];

      link.pc.ontrack = (e) => {
        smoothPlayback(link.pc); // colchón de reproducción para que no se trabe
        const [remote] = e.streams;
        if (remote) show(remote);
      };
      link.pc.onconnectionstatechange = () => {
        const st = link.pc.connectionState;
        if (st === 'connected') {
          setVia('p2p');
          setStatus('live');
        } else if (st === 'failed') setStatus('failed');
        else if (st === 'disconnected') setStatus('connecting');
      };

      try {
        await link.setRemote(sdp);
        const created = await link.pc.createAnswer();
        // Audio en estéreo: el que recibe también lo indica en su respuesta (ver opusStereo)
        const answer: RTCSessionDescriptionInit = { type: 'answer', sdp: opusStereo(created.sdp ?? '') };
        await link.pc.setLocalDescription(answer);
        if (linkRef.current === link) socket.emit('webrtc:answer', { callId, sdp: answer });
      } catch (err) {
        console.error('[guest] error respondiendo la oferta', err);
        setStatus('failed');
      }
    };
    const onIce = ({ callId, candidate }: { callId: string; candidate: RTCIceCandidateInit }) => {
      const link = linkRef.current;
      if (link?.callId === callId) void link.addIce(candidate);
      else if (callId === latestCallId && earlyIce.length < 50) earlyIce.push({ callId, candidate });
    };
    const onStop = () => {
      attempt++;
      pendingPub = null;
      reset();
    };

    socket.on('webrtc:offer', onOffer);
    socket.on('webrtc:ice', onIce);
    socket.on('webrtc:stop', onStop);
    socket.on('sfu:published', onSfuPublished);
    socket.on('sfu:unpublished', onSfuUnpublished);

    // Ya estamos escuchando: pedimos el video. Así funciona aunque entremos tarde, cuando el
    // anfitrión ya está compartiendo. (Si publica por el SFU, el servidor nos contesta 'sfu:published'.)
    if (hostId) socket.emit('webrtc:request');

    return () => {
      attempt++;
      socket.off('webrtc:offer', onOffer);
      socket.off('webrtc:ice', onIce);
      socket.off('webrtc:stop', onStop);
      socket.off('sfu:published', onSfuPublished);
      socket.off('sfu:unpublished', onSfuUnpublished);
      reset();
    };
  }, [meId, hostId]);

  // Calidad automática (solo por SFU): cada 2 s medimos cómo llega el video y, si hace
  // falta, pedimos otra capa. Así el que tiene mal internet baja SIN afectar a los demás.
  useEffect(() => {
    if (status !== 'live' || via !== 'sfu') return;
    const auto = new AutoLayer(layerRef.current, Date.now());
    let prev: RecvSample | null = null;
    let busy = false;
    let tick = 0;
    const timer = setInterval(async () => {
      const sub = sfuRef.current;
      if (!sub || busy) return;
      busy = true;
      try {
        const cur = await readRecvSample(sub.pc).catch(() => null);
        if (!cur) return;
        const j = prev ? judge(prev, cur) : null;
        prev = cur;
        if (!j) return;
        setRecv({ height: cur.height, fps: Math.round(j.fps) });
        // Cada ~4 s le contamos al anfitrión cómo nos llega (para su panel)
        if (tick++ % 2 === 0) {
          socket.emit('sfu:stats', {
            layer: layerRef.current,
            auto: choiceRef.current === 'auto',
            height: cur.height,
            fps: j.fps,
            lossPct: j.lossRate * 100,
          });
        }
        // Se acaba de elegir "Auto": empieza de cero desde la capa pedida (la más alta)
        if (autoRestartRef.current) {
          autoRestartRef.current = false;
          auto.restart(layerRef.current, Date.now());
        }
        // El automático debe partir de la capa que de verdad se recibe (p. ej. si se eligió a mano)
        if (auto.layer !== layerRef.current) auto.sync(layerRef.current, Date.now());
        // Calidad elegida a mano: el automático no decide nada
        if (choiceRef.current !== 'auto') return;
        const next = auto.next(j, Date.now());
        if (!next) return;
        const before = layerRef.current;
        // Queda en la consola (F12) por qué cambió: útil para revisar una película con problemas
        console.info(
          `[guest] calidad automática: ${LAYER_LABEL[before]} -> ${LAYER_LABEL[next]}`,
          `(pérdida ${(j.lossRate * 100).toFixed(1)} %, espera ${Math.round(j.delayMs ?? 0)} ms,` +
            ` congelado ${j.froze ? 'sí' : 'no'}, ${Math.round(j.fps)} fps)`,
        );
        if (await askLayer(next)) {
          layerRef.current = next;
          setLayer(next);
        } else auto.sync(before, Date.now()); // el servidor no aceptó el cambio
      } finally {
        busy = false;
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [status, via]);

  /** El espectador elige la calidad: Auto o una capa fija. */
  async function chooseQuality(c: Choice) {
    setQualityOpen(false);
    setChoice(c);
    choiceRef.current = c;
    // "Auto" empieza por la más alta (Alta); si el internet no la aguanta, baja sola en unos segundos
    const want: SfuLayer = c === 'auto' ? 'f' : c;
    if (want !== layerRef.current && (await askLayer(want))) {
      layerRef.current = want;
      setLayer(want);
    }
    if (c === 'auto') autoRestartRef.current = true;
  }

  function unmute() {
    const video = videoRef.current;
    if (!video) return;
    video.muted = false;
    setMuted(false);
    video.play().catch(() => {});
  }

  function fullscreen() {
    const box = boxRef.current;
    const video = videoRef.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
    if (document.fullscreenElement) void document.exitFullscreen();
    else if (box?.requestFullscreen) void box.requestFullscreen();
    else video?.webkitEnterFullscreen?.(); // iPhone
  }

  return (
    <div ref={boxRef} className="relative size-full bg-black">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={muted}
        className="absolute inset-0 size-full object-contain"
      />

      {status !== 'live' && (
        <div className="absolute inset-0 grid place-items-center p-6 text-center">
          <div className="flex flex-col items-center gap-3 text-sm text-zinc-400">
            {status === 'waiting' &&
              (hostId
                ? 'Esperando a que el anfitrión comparta su pestaña…'
                : 'El anfitrión no está en la sala')}
            {status === 'connecting' && 'Conectando video…'}
            {status === 'failed' && (
              <>
                <span className="text-red-300">No se pudo conectar el video.</span>
                <button className="btn-secondary text-sm" onClick={() => socket.emit('webrtc:request')}>
                  Reintentar
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {status === 'live' && muted && (
        <button
          onClick={unmute}
          className="absolute inset-x-0 bottom-6 mx-auto w-fit rounded-full bg-violet-600 px-6 py-4 text-lg font-bold text-white shadow-xl shadow-black/50 hover:bg-violet-500"
        >
          🔊 Activar sonido
        </button>
      )}

      {overlay?.(isFullscreen)}

      {/* Pantalla completa: abajo a la derecha, donde no tapa nada */}
      {status === 'live' && (
        <button
          onClick={fullscreen}
          title="Pantalla completa"
          aria-label="Pantalla completa"
          className="absolute right-2 bottom-2 rounded-lg bg-black/50 px-2 py-1 text-sm text-white/80 hover:bg-black/70"
        >
          ⛶
        </button>
      )}

      {/* Calidad del video (solo si llega por Cloudflare): un botón chiquito ⚙ que al tocarlo
          muestra las opciones. Auto la ajusta según tu internet. */}
      {status === 'live' && via === 'sfu' && (
        <div ref={qualityRef}>
          <button
            onClick={() => setQualityOpen((v) => !v)}
            title="Calidad del video"
            aria-label="Calidad del video"
            aria-expanded={qualityOpen}
            className="absolute top-2 left-2 z-20 rounded-lg bg-black/50 p-1.5 text-white/85 hover:bg-black/70 phone-land:p-2"
          >
            {/* Engranaje dibujado (el emoji ⚙ sale muy chiquito en Android); más grande en horizontal */}
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="size-5 phone-land:size-7"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
          {qualityOpen && (
            <div
              role="menu"
              aria-label="Opciones de calidad"
              className="absolute top-11 left-2 z-30 phone-land:top-14 flex flex-col overflow-hidden rounded-lg bg-zinc-900/95 py-1 text-sm text-white shadow-xl shadow-black/50"
            >
              {(['auto', 'f', 'h', 'q'] as Choice[]).map((c) => (
                <button
                  key={c}
                  role="menuitemradio"
                  aria-checked={choice === c}
                  data-value={c}
                  onClick={() => void chooseQuality(c)}
                  className="flex items-center gap-2 px-3 py-1.5 text-left whitespace-nowrap hover:bg-white/10"
                >
                  <span className="w-3">{choice === c ? '✓' : ''}</span>
                  {c === 'auto'
                    ? `Auto · ${LAYER_LABEL[layer]}${recv?.height ? ` ${recv.height}p` : ''}`
                    : LAYER_LABEL[c]}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
