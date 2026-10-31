// Visor del INVITADO: recibe por WebRTC la pestaña que comparte el anfitrión.
// Dos caminos:
//   - SFU: el video llega desde Cloudflare (cuando el anfitrión publica ahí).
//   - P2P: conexión directa con el anfitrión (si no hay SFU o si el SFU falla).
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { SfuLayer } from '@lazo/shared';
import { subscribeFromSfu, type SfuSubscriber } from '../../lib/sfu';
import { AutoLayer, judge, readRecvSample, type RecvSample, smoothPlayback } from '../../lib/sfuQuality';
import { ExpandIcon, GearIcon, SpeakerIcon } from '../../components/icons';
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
    // Todo lo que va encima del video usa colores fijos (blanco sobre oscuro), no los del tema:
    // el video siempre tiene fondo negro y así se lee bien también con el tema Fiamma.
    <div ref={boxRef} className="relative size-full bg-black">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={muted}
        className={`absolute inset-0 size-full object-contain transition-opacity duration-700 ${
          status === 'live' ? 'opacity-100' : 'opacity-0'
        }`}
      />

      {status !== 'live' && (
        // key = status: al cambiar de estado, el aviso nuevo aparece con animación
        <div
          key={status}
          className="animate-fade-in absolute inset-0 grid place-items-center p-6 text-center"
        >
          <div className="flex flex-col items-center gap-4 text-sm text-white/70">
            {status === 'waiting' && (
              <>
                <span className="animate-float grid size-14 place-items-center rounded-2xl bg-white/5 ring-1 ring-white/10">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.5}
                    className="size-7"
                    aria-hidden
                  >
                    <rect x="3" y="5" width="18" height="12" rx="2" />
                    <path d="M8 21h8M12 17v4M10 9.5v3l2.6-1.5L10 9.5Z" strokeLinejoin="round" />
                  </svg>
                </span>
                {hostId
                  ? 'Esperando a que el anfitrión comparta su pestaña…'
                  : 'El anfitrión no está en la sala'}
                <Dots />
              </>
            )}
            {status === 'connecting' && (
              <>
                <span
                  aria-hidden
                  className="size-10 animate-spin rounded-full border-[3px] border-white/15 border-t-violet-400"
                />
                Conectando video…
              </>
            )}
            {status === 'failed' && (
              <>
                <span className="grid size-12 place-items-center rounded-full bg-red-500/15 text-red-400 ring-1 ring-red-500/30">
                  <svg viewBox="0 0 20 20" fill="currentColor" className="size-6" aria-hidden>
                    <path d="M10 2a8 8 0 1 1 0 16 8 8 0 0 1 0-16Zm0 4a1 1 0 0 0-1 1v3.5a1 1 0 1 0 2 0V7a1 1 0 0 0-1-1Zm0 8.5A1.1 1.1 0 1 0 10 12.3a1.1 1.1 0 0 0 0 2.2Z" />
                  </svg>
                </span>
                <span className="text-red-300">No se pudo conectar el video.</span>
                <button
                  className="rounded-full bg-white/10 px-5 py-2 font-medium text-white ring-1 ring-white/15 transition hover:bg-white/20 active:scale-95"
                  onClick={() => socket.emit('webrtc:request')}
                >
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
          className="animate-pop-in absolute inset-x-0 bottom-6 isolate mx-auto flex w-fit items-center gap-2.5 rounded-full bg-linear-to-b from-violet-500 to-violet-600 px-6 py-3.5 text-lg font-bold text-white shadow-lg shadow-black/40 ring-1 ring-white/20 transition hover:brightness-110 active:scale-95"
        >
          {/* Halo que late para llamar la atención */}
          <span
            aria-hidden
            className="animate-glow absolute -inset-1 -z-10 rounded-full bg-violet-500/50 blur-md"
          />
          <SpeakerIcon />
          Activar sonido
        </button>
      )}

      {overlay?.(isFullscreen)}

      {/* Pantalla completa: abajo a la derecha, donde no tapa nada */}
      {status === 'live' && (
        <button
          onClick={fullscreen}
          title="Pantalla completa"
          aria-label="Pantalla completa"
          className="glass-btn animate-fade-in absolute right-3 bottom-3 size-11"
        >
          <ExpandIcon className="size-5 phone-land:size-6" exit={isFullscreen} />
        </button>
      )}

      {/* Calidad del video (solo si llega por Cloudflare): un botón ⚙ que al tocarlo muestra las
          opciones. Auto la ajusta según tu internet. */}
      {status === 'live' && via === 'sfu' && (
        <div ref={qualityRef}>
          <button
            onClick={() => setQualityOpen((v) => !v)}
            title="Calidad del video"
            aria-label="Calidad del video"
            aria-expanded={qualityOpen}
            className={`glass-btn animate-fade-in absolute top-3 left-3 z-20 size-11 ${qualityOpen ? 'bg-black/70' : ''}`}
          >
            {/* Engranaje dibujado (el emoji ⚙ sale muy chiquito en Android); más grande en horizontal.
                Gira un poco al abrir las opciones. */}
            <GearIcon
              className={`size-5 transition-transform duration-300 phone-land:size-6 ${qualityOpen ? 'rotate-90' : ''}`}
            />
          </button>
          {qualityOpen && (
            <div
              role="menu"
              aria-label="Opciones de calidad"
              className="animate-scale-in absolute top-16 left-3 z-30 flex min-w-44 origin-top-left flex-col rounded-xl bg-black/80 p-1.5 text-sm text-white shadow-2xl ring-1 ring-white/10 backdrop-blur-md"
            >
              <span className="px-2.5 pt-1 pb-1.5 text-[11px] font-semibold tracking-wider text-white/45 uppercase">
                Calidad
              </span>
              {(['auto', 'f', 'h', 'q'] as Choice[]).map((c) => (
                <button
                  key={c}
                  role="menuitemradio"
                  aria-checked={choice === c}
                  data-value={c}
                  onClick={() => void chooseQuality(c)}
                  className={`flex items-center gap-2 rounded-lg px-2.5 py-2 text-left whitespace-nowrap transition hover:bg-white/10 ${
                    choice === c ? 'font-medium text-white' : 'text-white/75'
                  }`}
                >
                  <span className="w-4 text-violet-300">{choice === c ? '✓' : ''}</span>
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

/** Tres puntitos que saltan uno tras otro (esperando). */
function Dots() {
  return (
    <span aria-hidden className="flex gap-1.5">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="size-1.5 animate-bounce rounded-full bg-white/40"
          style={{ animationDelay: `${i * 150}ms` }}
        />
      ))}
    </span>
  );
}
