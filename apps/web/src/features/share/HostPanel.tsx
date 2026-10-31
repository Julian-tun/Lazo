// Panel del ANFITRIÓN: abrir un link en otra pestaña y compartir esa pestaña con audio.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Participant, RoomTheme, SfuStats } from '@lazo/shared';
import {
  getPublishStats,
  publishToSfu,
  tuneSimulcast,
  type LayerStats,
  type SfuPublisher,
} from '../../lib/sfu';
import { Avatar } from '../../components/Avatar';
import { socket } from '../../lib/socket';
import {
  captureConstraints,
  CONTENT,
  createPeerLink,
  getIceConfig,
  getRoute,
  getSendStats,
  newCallId,
  opusStereo,
  preferVp9,
  refreshAdaptation,
  QUALITY,
  tuneVideoSender,
  type ContentType,
  type PeerLink,
  type Quality,
  type Route,
  type SendStats,
} from '../../lib/webrtc';

interface Props {
  meId: string; // mi id de conexión: cambia si me reconecté (ver el efecto del SFU)
  guests: Participant[]; // espectadores en la sala (máx. 3)
  theme: RoomTheme; // tema de colores para todos (normal o rosita)
  onTheme: (theme: RoomTheme) => void;
  fiesta: boolean; // ¿está activo el modo fiesta? 🎂
  onFiesta: (on: boolean) => Promise<string | null>; // activa/desactiva (devuelve error o null)
}

const PEER_LABEL: Record<RTCPeerConnectionState, string> = {
  new: 'conectando…',
  connecting: 'conectando…',
  connected: 'viendo ✓',
  disconnected: 'conexión inestable…',
  failed: 'falló la conexión',
  closed: 'sin video',
};

// Cómo se envía el video: preparando, por Cloudflare (SFU) o directo a cada espectador (P2P)
type Mode = 'iniciando' | 'sfu' | 'p2p';

// Nombre de cada capa del simulcast
const LAYER_LABEL: Record<LayerStats['rid'], string> = { f: 'Alta', h: 'Media', q: 'Baja' };

/** Acepta "youtube.com/..." y le añade https:// si falta. Devuelve null si no es válido. */
function normalizeUrl(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

export function HostPanel({ meId, guests, theme, onTheme, fiesta, onFiesta }: Props) {
  const [url, setUrl] = useState('');
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [noAudio, setNoAudio] = useState(false);
  // Estado de la conexión con cada espectador (clave = id del espectador)
  const [peerStates, setPeerStates] = useState<Record<string, RTCPeerConnectionState>>({});
  // Por dónde va el video de cada espectador: directo o por TURN
  const [routes, setRoutes] = useState<Record<string, Route>>({});
  // ¿Hay respaldo TURN disponible? (null = aún no se sabe)
  const [turnReady, setTurnReady] = useState<boolean | null>(null);
  // Calidad máxima elegida por el anfitrión
  const [quality, setQuality] = useState<Quality>('normal');
  const qualityRef = useRef(quality);
  qualityRef.current = quality;
  // Qué se comparte: película (cuidar fluidez) o página/texto (cuidar nitidez)
  const [content, setContent] = useState<ContentType>('pelicula');
  const contentRef = useRef(content); // se actualiza en changeContent
  // Calidad real que recibe cada espectador ahora mismo
  const [sendInfo, setSendInfo] = useState<
    Record<
      string,
      {
        height: number | null;
        fps: number | null;
        kbps: number | null;
        limitedBy: SendStats['limitedBy'];
        codec: string | null;
      }
    >
  >({});
  // Lo que Chrome captura de la pestaña (tamaño y cuadros por segundo)
  const [capture, setCapture] = useState<{ width: number; height: number; fps: number | null } | null>(null);
  // Cómo se envía el video ahora (null = no se comparte)
  const [mode, setMode] = useState<Mode | null>(null);
  const modeRef = useRef<Mode | null>(null);
  const setModeBoth = useCallback((m: Mode | null) => {
    modeRef.current = m;
    setMode(m);
  }, []);
  // Conexión con el SFU de Cloudflare (solo en modo 'sfu')
  const sfuRef = useRef<SfuPublisher | null>(null);
  // Lo que se envía al SFU: cada capa y la velocidad total
  const [sfuInfo, setSfuInfo] = useState<{ layers: LayerStats[]; kbps: number | null } | null>(null);
  // Lo que cada espectador dice que recibe por el SFU (clave = id del espectador)
  const [guestStats, setGuestStats] = useState<Record<string, SfuStats & { at: number }>>({});
  // Último conteo de bytes enviados, para calcular la velocidad (kbps)
  const lastBytesRef = useRef(new Map<string, { bytes: number; at: number }>());
  // Última vez que el "guardián" reinició la calidad de cada espectador
  const lastFixRef = useRef(new Map<string, number>());

  const previewRef = useRef<HTMLVideoElement>(null);
  // Una conexión WebRTC por espectador (clave = id del espectador)
  const linksRef = useRef(new Map<string, PeerLink>());
  // Copias en refs para usarlas dentro de listeners sin re-registrarlos
  const streamRef = useRef(stream);
  streamRef.current = stream;
  const guestsRef = useRef(guests);
  guestsRef.current = guests;

  const canShare = typeof navigator.mediaDevices?.getDisplayMedia === 'function';

  const setPeerState = useCallback((guestId: string, state: RTCPeerConnectionState | null) => {
    setPeerStates((prev) => {
      const next = { ...prev };
      if (state) next[guestId] = state;
      else delete next[guestId];
      return next;
    });
  }, []);

  /** Cierra la conexión con un espectador. */
  const closeCall = useCallback(
    (guestId: string) => {
      linksRef.current.get(guestId)?.close();
      linksRef.current.delete(guestId);
      setPeerState(guestId, null);
    },
    [setPeerState],
  );

  const closeAll = useCallback(() => {
    for (const id of [...linksRef.current.keys()]) closeCall(id);
  }, [closeCall]);

  /** Crea una conexión nueva con UN espectador y le manda la oferta con el stream. */
  const startCall = useCallback(
    async (guestId: string) => {
      if (!streamRef.current) return;
      const { iceServers } = await getIceConfig(); // STUN + TURN de respaldo (si hay)
      const s = streamRef.current;
      if (!s) return; // dejó de compartir mientras esperábamos
      closeCall(guestId);

      const callId = newCallId();
      const link = createPeerLink(callId, iceServers, (candidate) =>
        socket.emit('webrtc:ice', { to: guestId, callId, candidate }),
      );
      linksRef.current.set(guestId, link);
      setPeerState(guestId, 'new');
      link.pc.onconnectionstatechange = () => setPeerState(guestId, link.pc.connectionState);

      for (const track of s.getTracks()) link.pc.addTrack(track, s);
      preferVp9(link.pc); // más nitidez con la misma red (si el espectador no tiene VP9, queda VP8)

      try {
        const offer = await link.pc.createOffer();
        if (linksRef.current.get(guestId) !== link) return; // mientras tanto empezó otro intento
        await link.pc.setLocalDescription(offer);
        await tuneVideoSender(link.pc, qualityRef.current, contentRef.current); // tope de calidad + qué cuidar
        socket.emit('webrtc:offer', { to: guestId, callId, sdp: offer });
      } catch (err) {
        console.error('[host] error creando la oferta', err);
        setPeerState(guestId, 'failed');
      }
    },
    [closeCall, setPeerState],
  );

  // Mensajes de los espectadores: respuesta, candidatos ICE y "pedir video"
  useEffect(() => {
    const onAnswer = ({
      fromId,
      callId,
      sdp,
    }: {
      fromId: string;
      callId: string;
      sdp: RTCSessionDescriptionInit;
    }) => {
      const link = linksRef.current.get(fromId);
      if (link?.callId !== callId) return;
      // Audio en estéreo y con más calidad (ver opusStereo)
      link
        .setRemote({ type: sdp.type, sdp: opusStereo(sdp.sdp ?? '') })
        .catch((e) => console.error('[host] answer', e));
    };
    const onIce = ({
      fromId,
      callId,
      candidate,
    }: {
      fromId: string;
      callId: string;
      candidate: RTCIceCandidateInit;
    }) => {
      const link = linksRef.current.get(fromId);
      if (link?.callId === callId) void link.addIce(candidate);
    };
    // Un espectador está listo (entró, entró tarde o pulsó "Reintentar").
    // Si enviamos por el SFU, él recibe de Cloudflare: solo usamos conexión directa
    // si estamos en modo P2P o si a ese espectador el SFU le falló (p2p = true).
    const onRequest = ({ fromId, p2p }: { fromId: string; p2p: boolean }) => {
      if (modeRef.current !== 'p2p' && !p2p) return;
      void startCall(fromId);
    };

    // Un espectador cuenta cómo le llega el video por el SFU
    const onStats = ({ fromId, ...st }: SfuStats & { fromId: string }) =>
      setGuestStats((prev) => ({ ...prev, [fromId]: { ...st, at: Date.now() } }));

    socket.on('webrtc:answer', onAnswer);
    socket.on('webrtc:ice', onIce);
    socket.on('webrtc:request', onRequest);
    socket.on('sfu:stats', onStats);
    return () => {
      socket.off('webrtc:answer', onAnswer);
      socket.off('webrtc:ice', onIce);
      socket.off('webrtc:request', onRequest);
      socket.off('sfu:stats', onStats);
    };
  }, [startCall]);

  // Al empezar a compartir: publicar por el SFU de Cloudflare si está configurado.
  // Si no lo está (o falla), conexión directa con cada espectador, como antes. Nunca sin video.
  // También se repite si me reconecté (meId cambia): si mi internet o el túnel se cortó un
  // momento, el servidor me sacó de la sala y apagó mi video; al volver lo mando de nuevo solo.
  useEffect(() => {
    if (!stream) return;
    let cancelled = false;
    modeRef.current = 'iniciando'; // la vista muestra "preparando…" mientras mode siga en null

    const goP2P = () => {
      setModeBoth('p2p');
      for (const g of guestsRef.current) void startCall(g.id);
    };
    const dropSfu = () => {
      sfuRef.current?.close();
      sfuRef.current = null;
      socket.emit('sfu:unpublish');
    };

    void (async () => {
      const cfg = await getIceConfig();
      if (cancelled) return;
      if (!cfg.sfu) return goP2P();
      try {
        const pub = await publishToSfu(stream, cfg.iceServers, qualityRef.current, contentRef.current, () => {
          // Se cayó la conexión con Cloudflare: seguimos por conexión directa
          if (sfuRef.current !== pub || cancelled) return;
          console.warn('[host] se cayó la conexión con el SFU; paso a conexión directa');
          dropSfu();
          goP2P();
        });
        if (cancelled) {
          pub.close();
          socket.emit('sfu:unpublish');
          return;
        }
        sfuRef.current = pub;
        setModeBoth('sfu');
      } catch (err) {
        if (cancelled) return;
        console.warn('[host] no se pudo usar el SFU; uso conexión directa', err);
        socket.emit('sfu:unpublish'); // por si el servidor alcanzó a registrar algo
        goP2P();
      }
    })();

    return () => {
      cancelled = true;
      closeAll();
      if (sfuRef.current) dropSfu();
      setModeBoth(null);
      setSfuInfo(null);
    };
  }, [stream, meId, startCall, closeAll, setModeBoth]);

  // Si un espectador se va, cerramos solo su conexión
  useEffect(() => {
    const present = new Set(guests.map((g) => g.id));
    for (const id of [...linksRef.current.keys()]) if (!present.has(id)) closeCall(id);
  }, [guests, closeCall]);

  // Saber si el respaldo TURN está configurado en el servidor
  useEffect(() => {
    void getIceConfig().then((c) => setTurnReady(c.turn));
  }, []);

  // Cada 4 s: por dónde va cada conexión (directa o TURN) y con qué calidad se envía
  useEffect(() => {
    const timer = setInterval(async () => {
      const nextRoutes: Record<string, Route> = {};
      const nextInfo: typeof sendInfo = {};
      let nextCapture: typeof capture = null;
      for (const [id, link] of linksRef.current) {
        if (link.pc.connectionState !== 'connected') continue;
        const route = await getRoute(link.pc).catch(() => null);
        if (route) nextRoutes[id] = route;

        const s = await getSendStats(link.pc).catch(() => null);
        if (!s) continue;
        // Velocidad = bytes enviados desde la última vez / tiempo transcurrido
        const last = lastBytesRef.current.get(id);
        const kbps =
          last && s.timestamp > last.at
            ? Math.round(((s.bytesSent - last.bytes) * 8) / (s.timestamp - last.at))
            : null;
        lastBytesRef.current.set(id, { bytes: s.bytesSent, at: s.timestamp });
        nextInfo[id] = { height: s.height, fps: s.fps, kbps, limitedBy: s.limitedBy, codec: s.codec };
        if (!nextCapture && s.sourceWidth && s.sourceHeight)
          nextCapture = { width: s.sourceWidth, height: s.sourceHeight, fps: s.sourceFps };

        // Guardián: Chrome a veces se queda atascado en la calidad baja del inicio. Lo reiniciamos si:
        // a) dice "limitado por la red" pero sobra red (3 veces lo que envía y al menos 1 Mbps), o
        // b) NO dice que haya límite, pero envía menos de la mitad del alto que captura.
        // Como mucho una vez cada 15 s por espectador. Si la red de verdad es mala, no hace nada.
        const lastFix = lastFixRef.current.get(id) ?? 0;
        const stuckByNetwork =
          s.limitedBy === 'bandwidth' &&
          kbps !== null &&
          s.availableKbps !== null &&
          s.availableKbps >= 1000 &&
          s.availableKbps > kbps * 3;
        const stuckForNoReason =
          s.limitedBy === 'none' &&
          s.height !== null &&
          s.sourceHeight !== null &&
          s.height < s.sourceHeight * 0.5;
        if ((stuckByNetwork || stuckForNoReason) && Date.now() - lastFix > 15_000) {
          lastFixRef.current.set(id, Date.now());
          void refreshAdaptation(link.pc, contentRef.current);
        }
      }
      // Envío por el SFU: cada capa, velocidad total y guardián de la capa completa
      const pub = sfuRef.current;
      let nextSfu: typeof sfuInfo = null;
      if (pub && pub.pc.connectionState === 'connected') {
        const st = await getPublishStats(pub.pc).catch(() => null);
        if (st) {
          const last = lastBytesRef.current.get('sfu');
          const kbps =
            last && st.timestamp > last.at
              ? Math.round(((st.bytesSent - last.bytes) * 8) / (st.timestamp - last.at))
              : null;
          lastBytesRef.current.set('sfu', { bytes: st.bytesSent, at: st.timestamp });
          nextSfu = { layers: st.layers, kbps };
          if (!nextCapture && st.source) nextCapture = st.source;
          // Misma regla b) del guardián: capa completa chica sin ningún límite = atascada
          const f = st.layers.find((l) => l.rid === 'f');
          const lastFix = lastFixRef.current.get('sfu') ?? 0;
          if (
            f?.limitedBy === 'none' &&
            f.height !== null &&
            st.source &&
            f.height < st.source.height * 0.5 &&
            Date.now() - lastFix > 15_000
          ) {
            lastFixRef.current.set('sfu', Date.now());
            void refreshAdaptation(pub.pc, contentRef.current);
          }
        }
      }
      setSfuInfo(nextSfu);
      // Sin espectadores conectados: lo que Chrome dice de la captura (sin fps reales)
      if (!nextCapture) {
        const set = streamRef.current?.getVideoTracks()[0]?.getSettings();
        if (set?.width && set.height) nextCapture = { width: set.width, height: set.height, fps: null };
      }
      setRoutes(nextRoutes);
      setSendInfo(nextInfo);
      setCapture(nextCapture);
      // Olvidar datos de espectadores que dejaron de mandarlos (más de 12 s)
      setGuestStats((prev) => {
        const now = Date.now();
        const next = Object.fromEntries(Object.entries(prev).filter(([, v]) => now - v.at < 12_000));
        return Object.keys(next).length === Object.keys(prev).length ? prev : next;
      });
    }, 4000);
    return () => clearInterval(timer);
  }, []);

  /** Cambia la calidad máxima: ajusta la captura y el envío a todos los espectadores. */
  async function changeQuality(q: Quality) {
    setQuality(q);
    const video = streamRef.current?.getVideoTracks()[0];
    if (video)
      await video.applyConstraints(captureConstraints(q)).catch((e) => console.warn('[host] calidad', e));
    for (const link of linksRef.current.values()) await tuneVideoSender(link.pc, q, contentRef.current);
    if (sfuRef.current) await tuneSimulcast(sfuRef.current.pc, q, contentRef.current);
  }

  /** Cambia el tipo de contenido (película o texto). Se puede cambiar mientras se comparte. */
  async function changeContent(c: ContentType) {
    setContent(c);
    contentRef.current = c;
    const video = streamRef.current?.getVideoTracks()[0];
    if (video) video.contentHint = CONTENT[c].hint;
    for (const link of linksRef.current.values()) await tuneVideoSender(link.pc, qualityRef.current, c);
    if (sfuRef.current) await tuneSimulcast(sfuRef.current.pc, qualityRef.current, c);
  }

  // Vista previa local de lo que se comparte
  useEffect(() => {
    if (previewRef.current) previewRef.current.srcObject = stream;
  }, [stream]);

  // Al salir de la sala, soltar la captura
  useEffect(() => () => streamRef.current?.getTracks().forEach((t) => t.stop()), []);

  const stopShare = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    setStream(null);
    setNoAudio(false);
    setCapture(null);
    socket.emit('webrtc:stop');
  }, []);

  function openTab() {
    const u = normalizeUrl(url);
    if (!u) return setMessage('Ese link no parece válido');
    setMessage(null);
    window.open(u, '_blank', 'noopener,noreferrer');
  }

  async function startShare() {
    if (!canShare)
      return setMessage('Este navegador no permite compartir pestañas. Usa Chrome o Edge en PC.');
    setMessage(null);
    try {
      // Opciones nuevas (selfBrowserSurface, etc.) aún no están en los tipos de TS
      const options = {
        video: { displaySurface: 'browser', ...captureConstraints(quality) },
        audio: true,
        selfBrowserSurface: 'exclude', // no ofrecer la pestaña de Lazo
        preferCurrentTab: false,
        surfaceSwitching: 'include', // permite cambiar de pestaña sin volver a empezar
        systemAudio: 'exclude',
      } as DisplayMediaStreamOptions;

      const s = await navigator.mediaDevices.getDisplayMedia(options);
      const video = s.getVideoTracks()[0];
      if (video) {
        video.contentHint = CONTENT[contentRef.current].hint; // fluidez (película) o nitidez (texto)
        // Si el usuario pulsa "Dejar de compartir" en la barra de Chrome
        video.addEventListener('ended', stopShare);
      }
      setNoAudio(s.getAudioTracks().length === 0);
      setStream(s);
    } catch (err) {
      const name = (err as DOMException)?.name;
      setMessage(
        name === 'NotAllowedError' ? 'Cancelaste la selección de pestaña' : 'No se pudo compartir la pestaña',
      );
    }
  }

  const sharing = stream !== null;

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-6">
      {!canShare && (
        <p className="animate-fade-in rounded-xl border border-amber-500/20 bg-amber-950/50 px-4 py-3 text-sm text-amber-200">
          Para compartir necesitas Chrome o Edge en una computadora. En el celular solo se puede ver como
          invitado.
        </p>
      )}

      {/* Paso 1: abrir el link */}
      <section className="card animate-fade-up flex flex-col gap-3 p-4 sm:p-5">
        <label className="flex items-center gap-2.5 text-sm font-medium text-zinc-200" htmlFor="share-url">
          <StepBadge n={1} />
          Pega el link que quieren ver
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            id="share-url"
            className="input min-w-0 flex-1"
            value={url}
            placeholder="https://…"
            inputMode="url"
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && openTab()}
          />
          <button className="btn-secondary" onClick={openTab}>
            Abrir en pestaña nueva
          </button>
        </div>
      </section>

      {/* Paso 2: compartir la pestaña */}
      <section
        className="card animate-fade-up flex flex-col gap-4 p-4 sm:p-5"
        style={{ animationDelay: '70ms' }}
      >
        <span className="flex items-center gap-2.5 text-sm font-medium text-zinc-200">
          <StepBadge n={2} />
          <span>
            Comparte esa pestaña <span className="font-normal text-zinc-500">(marca “Compartir audio”)</span>
          </span>
        </span>
        <div className="flex flex-wrap items-center gap-3">
          {sharing ? (
            <button className="btn-danger" onClick={stopShare}>
              Dejar de compartir
            </button>
          ) : (
            <button className="btn-primary" onClick={startShare} disabled={!canShare}>
              Compartir pestaña
            </button>
          )}
          {/* Estado: "Compartiendo" con punto rojo que late, o "Detenido" */}
          <span
            className={`flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium transition ${
              sharing
                ? 'border-red-500/30 bg-red-500/10 text-red-300'
                : 'border-zinc-800 bg-zinc-900/60 text-zinc-400'
            }`}
          >
            <span className="relative flex size-2">
              {sharing && <span className="absolute inset-0 animate-ping rounded-full bg-red-500/70" />}
              <span className={`relative size-2 rounded-full ${sharing ? 'bg-red-500' : 'bg-zinc-600'}`} />
            </span>
            {sharing ? 'Compartiendo' : 'Detenido'}
          </span>
        </div>
        {/* Ajustes del envío (se pueden cambiar mientras se comparte) */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          {/* Calidad máxima: cada espectador recibe lo mejor que permita SU conexión, hasta este tope */}
          <label className="flex items-center gap-2 text-sm text-zinc-400">
            Calidad:
            <select
              className="select"
              value={quality}
              onChange={(e) => void changeQuality(e.target.value as Quality)}
            >
              {(Object.keys(QUALITY) as Quality[]).map((q) => (
                <option key={q} value={q}>
                  {QUALITY[q].label}
                </option>
              ))}
            </select>
          </label>
          {/* Qué se comparte: decide si se cuida la fluidez o la nitidez cuando falta red */}
          <label className="flex items-center gap-2 text-sm text-zinc-400">
            Contenido:
            <select
              className="select"
              value={content}
              onChange={(e) => void changeContent(e.target.value as ContentType)}
            >
              {(Object.keys(CONTENT) as ContentType[]).map((c) => (
                <option key={c} value={c}>
                  {CONTENT[c].label}
                </option>
              ))}
            </select>
          </label>
        </div>
        {/* Estado del envío: cómo sale el video, qué se captura y cómo le llega a cada uno */}
        {sharing && (
          <div className="animate-fade-in space-y-1.5 rounded-xl border border-zinc-800/80 bg-zinc-950/40 p-3">
            {/* Cómo se envía el video: por Cloudflare (una sola subida) o directo a cada espectador */}
            {sharing && (
              <p className="text-xs text-zinc-500">
                Envío: {(mode === null || mode === 'iniciando') && 'preparando…'}
                {mode === 'p2p' && 'directo a cada espectador (P2P)'}
                {mode === 'sfu' && (
                  <span className="text-sky-300">vía Cloudflare (SFU): una sola subida para todos</span>
                )}
                {mode === 'sfu' && sfuInfo && (
                  <span>
                    {' · capas '}
                    {sfuInfo.layers
                      .map((l) => `${LAYER_LABEL[l.rid]} ${l.height ? `${l.height}p` : 'pausada'}`)
                      .join(' / ')}
                    {sfuInfo.kbps !== null && ` · ${(sfuInfo.kbps / 1000).toFixed(1)} Mbps`}
                  </span>
                )}
                {mode === 'sfu' && sfuInfo?.layers.some((l) => l.limitedBy === 'cpu') && (
                  <span className="text-amber-300"> · ⚠ limitado por tu compu</span>
                )}
                {mode === 'sfu' && sfuInfo?.layers.some((l) => l.limitedBy === 'bandwidth') && (
                  <span className="text-amber-300"> · ⚠ limitado por tu subida de internet</span>
                )}
              </p>
            )}
            {/* Lo que Chrome captura de la pestaña: si aquí ya sale chico o lento, el problema es la captura */}
            {sharing && capture && (
              <p className="text-xs text-zinc-500">
                Captura: {capture.width}x{capture.height}
                {capture.fps !== null && ` ${Math.round(capture.fps)}fps`}
                {capture.fps !== null && capture.fps < 15 && (
                  <span className="text-amber-300">
                    {' '}
                    · ⚠ Chrome captura pocos cuadros: deja la pestaña compartida a la vista y la compu
                    conectada a la corriente
                  </span>
                )}
              </p>
            )}
            {sharing &&
              (guests.length === 0 ? (
                <p className="flex items-center gap-2 text-xs text-zinc-400">
                  <span className="size-1.5 animate-pulse rounded-full bg-zinc-500" />
                  Esperando a que entren espectadores…
                </p>
              ) : (
                // Una línea por espectador con el estado de su video
                <ul className="space-y-1.5 text-xs text-zinc-400">
                  {guests.map((g) => {
                    const state = peerStates[g.id];
                    const route = state === 'connected' ? routes[g.id] : undefined;
                    const info = state === 'connected' ? sendInfo[g.id] : undefined;
                    const gs = guestStats[g.id];
                    return (
                      <li key={g.id} className="animate-fade-in flex items-start gap-2">
                        <Avatar name={g.name} className="size-5 text-[10px]" />
                        {/* Todo el texto de la fila va junto, en una sola línea */}
                        <span className="pt-0.5">
                          {g.name}:{' '}
                          <span
                            className={
                              state === 'connected'
                                ? 'text-emerald-400'
                                : state === 'failed'
                                  ? 'text-red-300'
                                  : ''
                            }
                          >
                            {state ? PEER_LABEL[state] : mode === 'sfu' ? '' : 'esperando…'}
                          </span>
                          {/* Por Cloudflare: lo que el espectador dice que recibe (capa, alto, fps y pérdidas) */}
                          {!state &&
                            mode === 'sfu' &&
                            (gs ? (
                              <>
                                <span className="text-emerald-400">viendo ✓</span>
                                <span className="text-sky-300"> · Cloudflare</span>
                                <span className="text-zinc-500">
                                  {` · ${LAYER_LABEL[gs.layer]}${gs.auto ? '' : ' (fija)'}`}
                                  {gs.height ? ` ${gs.height}p` : ''}
                                  {` ${gs.fps}fps`}
                                </span>
                                {gs.lossPct >= 3 && (
                                  <span className="text-amber-300">
                                    {' '}
                                    · ⚠ su internet pierde {gs.lossPct}%
                                  </span>
                                )}
                              </>
                            ) : (
                              <span className="text-sky-300">conectando por Cloudflare…</span>
                            ))}
                          {route && (
                            <span className={route === 'relay' ? 'text-sky-300' : 'text-zinc-500'}>
                              {route === 'relay' ? ' · por TURN (respaldo)' : ' · directo'}
                            </span>
                          )}
                          {/* Calidad real que le llega: alto en píxeles, cuadros por segundo y velocidad */}
                          {info?.height && (
                            <span className="text-zinc-500">
                              {` · ${info.height}p`}
                              {info.fps ? ` ${Math.round(info.fps)}fps` : ''}
                              {info.kbps !== null ? ` ${(info.kbps / 1000).toFixed(1)} Mbps` : ''}
                              {info.codec ? ` ${info.codec}` : ''}
                            </span>
                          )}
                          {info?.limitedBy === 'cpu' && (
                            <span className="text-amber-300"> · ⚠ limitado por tu compu</span>
                          )}
                          {info?.limitedBy === 'bandwidth' && (
                            <span className="text-amber-300"> · ⚠ limitado por la red</span>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              ))}
          </div>
        )}
      </section>

      {/* Ambiente de la sala: tema de colores y modo fiesta (para todos) */}
      <section
        className="card animate-fade-up flex flex-col gap-3 p-4 sm:p-5"
        style={{ animationDelay: '140ms' }}
      >
        {/* Tema de colores: se cambia para todos y se queda guardado para la próxima vez */}
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-sm text-zinc-400">
            Tema:
            <select className="select" value={theme} onChange={(e) => onTheme(e.target.value as RoomTheme)}>
              <option value="normal">Normal (oscuro)</option>
              <option value="fiamma">Fiamma 🌸 (rosita)</option>
            </select>
          </label>
          <span className="text-xs text-zinc-500">Todos lo ven y se queda así siempre</span>
        </div>

        {/* Modo fiesta 🎂: canción y felicitaciones para todos los de la sala */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={async () => {
              const err = await onFiesta(!fiesta);
              if (err) setMessage(err);
            }}
            className={`rounded-full px-4 py-2 text-sm font-semibold transition active:scale-95 ${
              fiesta
                ? 'bg-linear-to-r from-pink-500 to-fuchsia-500 text-white shadow-lg shadow-pink-500/25 hover:brightness-110'
                : 'border border-zinc-700/70 bg-zinc-800/80 text-zinc-200 hover:bg-zinc-700/80'
            }`}
          >
            {fiesta ? '🎉 Modo fiesta: activado' : '🎂 Activar modo fiesta'}
          </button>
          {fiesta && (
            <span className="text-xs text-zinc-400">Todos lo ven 💖 (pulsa otra vez para quitarlo)</span>
          )}
        </div>

        {/* ¿Hay respaldo TURN por si la conexión directa falla? */}
        {turnReady !== null && (
          <p className="text-xs text-zinc-500">
            Respaldo TURN:{' '}
            {turnReady ? (
              <span className="text-emerald-400">listo ✓ (solo se usa si la conexión directa falla)</span>
            ) : (
              <span>no configurado (solo conexión directa)</span>
            )}
          </p>
        )}
      </section>

      {noAudio && (
        <p className="animate-scale-in rounded-xl border border-amber-500/20 bg-amber-950/50 px-4 py-3 text-sm text-amber-200">
          No se está compartiendo audio. Vuelve a compartir y activa “Compartir audio de la pestaña”.
        </p>
      )}
      {message && (
        <p
          role="alert"
          className="animate-scale-in rounded-xl border border-red-500/20 bg-red-950/50 px-4 py-3 text-sm text-red-300"
        >
          {message}
        </p>
      )}

      {/* Vista previa local (silenciada para no oír eco) */}
      <div
        className="animate-fade-up overflow-hidden rounded-2xl border border-zinc-800/80 bg-black shadow-2xl shadow-black/30"
        style={{ animationDelay: '210ms' }}
      >
        <div className="relative aspect-video">
          <video
            ref={previewRef}
            autoPlay
            playsInline
            muted
            className="absolute inset-0 size-full object-contain"
          />
          {!sharing && (
            <p className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 text-center text-sm text-zinc-500">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
                className="size-10 text-zinc-700"
                aria-hidden
              >
                <rect x="3" y="4" width="18" height="13" rx="2" />
                <path d="M8 21h8M12 17v4" strokeLinecap="round" />
              </svg>
              Aquí verás una vista previa de lo que compartes
            </p>
          )}
          {sharing && (
            <span className="animate-fade-in absolute top-3 left-3 flex items-center gap-1.5 rounded-full bg-red-600/90 px-2.5 py-1 text-[11px] font-bold tracking-wide text-white shadow-lg">
              <span className="size-1.5 animate-pulse rounded-full bg-white" />
              EN VIVO
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/** Número de paso en un círculo (1, 2…). */
function StepBadge({ n }: { n: number }) {
  return (
    <span className="grid size-6 shrink-0 place-items-center rounded-full bg-violet-500/15 text-xs font-bold text-violet-400 ring-1 ring-violet-500/30">
      {n}
    </span>
  );
}
