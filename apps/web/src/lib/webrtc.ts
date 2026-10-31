// Utilidades WebRTC: conexiones P2P entre el anfitrión y cada espectador.
// El video/audio va directo entre los navegadores; el servidor solo pasa
// los mensajes de "señalización" (offer / answer / ice).
import type { IceConfig } from '@lazo/shared';
import { ACK_TIMEOUT_MS, socket } from './socket';

// Si no se puede pedir la configuración al servidor: solo STUN (conexión directa)
const FALLBACK: IceConfig = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
  turn: false,
  sfu: false,
};

let cached: { config: IceConfig; at: number } | null = null;
const CACHE_MS = 60 * 60 * 1000; // 1 h (las credenciales TURN duran más)

/**
 * Servidores STUN/TURN que da el servidor. El TURN (si existe) es solo un respaldo:
 * WebRTC siempre prueba primero la conexión directa y usa el TURN solo si esa falla.
 */
export async function getIceConfig(): Promise<IceConfig> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.config;
  try {
    const r = await socket.timeout(ACK_TIMEOUT_MS).emitWithAck('webrtc:config');
    if (!r.ok) return FALLBACK; // p. ej. aún no estamos en una sala: no lo guardamos
    cached = { config: r.data, at: Date.now() };
    return r.data;
  } catch {
    return FALLBACK;
  }
}

export interface PeerLink {
  pc: RTCPeerConnection;
  callId: string;
  /** Aplica la descripción remota y luego los candidatos ICE que llegaron antes. */
  setRemote(sdp: RTCSessionDescriptionInit): Promise<void>;
  /** Añade un candidato ICE (o lo guarda si aún no hay descripción remota). */
  addIce(candidate: RTCIceCandidateInit): Promise<void>;
  close(): void;
}

/** Id único para cada intento de conexión. */
export function newCallId(): string {
  return crypto.randomUUID();
}

/**
 * Crea una RTCPeerConnection con lo básico ya resuelto.
 * onLocalIce se llama con cada candidato propio, para mandarlo al otro por el servidor.
 */
export function createPeerLink(
  callId: string,
  iceServers: RTCIceServer[],
  onLocalIce: (c: RTCIceCandidateInit) => void,
): PeerLink {
  const pc = new RTCPeerConnection({ iceServers });
  const pending: RTCIceCandidateInit[] = [];

  pc.onicecandidate = (e) => {
    if (e.candidate) onLocalIce(e.candidate.toJSON());
  };

  const safeAdd = (c: RTCIceCandidateInit) =>
    pc.addIceCandidate(c).catch((err) => console.warn('[webrtc] candidato ICE ignorado', err));

  return {
    pc,
    callId,
    async setRemote(sdp) {
      await pc.setRemoteDescription(sdp);
      for (const c of pending.splice(0)) await safeAdd(c);
    },
    async addIce(candidate) {
      if (pc.remoteDescription) await safeAdd(candidate);
      else pending.push(candidate);
    },
    close() {
      pc.onicecandidate = null;
      pc.ontrack = null;
      pc.onconnectionstatechange = null;
      pc.close();
    },
  };
}

// ---- Calidad del video que envía el anfitrión ----
// WebRTC ya ajusta la calidad SOLO para cada espectador según su conexión.
// Estos valores son el MÁXIMO al que puede llegar cuando la red y la compu lo permiten.
export type Quality = 'ahorro' | 'normal' | 'alta';

export const QUALITY: Record<Quality, { label: string; width: number; height: number; maxBitrate: number }> =
  {
    ahorro: { label: 'Ahorro (480p)', width: 854, height: 480, maxBitrate: 800_000 },
    normal: { label: 'Normal (720p)', width: 1280, height: 720, maxBitrate: 2_500_000 },
    alta: { label: 'Alta (1080p)', width: 1920, height: 1080, maxBitrate: 5_000_000 },
  };

// ---- Tipo de contenido que se comparte ----
// Le dice a Chrome qué cuidar más cuando falta red o compu:
// - Película: la FLUIDEZ (30 fps). Si falta red, baja un poco la nitidez.
// - Página / texto: la NITIDEZ (letras legibles). Si falta red, baja los fps.
export type ContentType = 'pelicula' | 'texto';
export type Degradation = 'balanced' | 'maintain-framerate' | 'maintain-resolution';

export const CONTENT: Record<ContentType, { label: string; hint: string; degradation: Degradation }> = {
  pelicula: { label: 'Película / video', hint: 'motion', degradation: 'maintain-framerate' },
  texto: { label: 'Página / texto', hint: 'detail', degradation: 'maintain-resolution' },
};

/**
 * Límites de captura para la pestaña compartida según la calidad elegida.
 * "ideal" le pide a Chrome que capture a ese tamaño y a 30 fps (no solo que no se pase).
 */
export function captureConstraints(q: Quality): MediaTrackConstraints {
  const { width, height } = QUALITY[q];
  return {
    width: { ideal: width, max: width },
    height: { ideal: height, max: height },
    frameRate: { ideal: 30, max: 30 },
  };
}

/**
 * Prefiere el códec VP9 para el video de esta conexión: a la misma velocidad de red
 * se ve más nítido que VP8. Los demás códecs quedan detrás, así que si el otro
 * navegador no tiene VP9 se usa VP8 como siempre. Hay que llamarla ANTES de createOffer.
 */
export function preferVp9(pc: RTCPeerConnection): void {
  const caps = RTCRtpReceiver.getCapabilities?.('video');
  if (!caps) return;
  // Orden: VP9 perfil 0 (el más compatible), luego otros VP9, luego el resto
  const rank = (c: RTCRtpCodec) =>
    c.mimeType.toLowerCase() !== 'video/vp9' ? 2 : /profile-id=0/.test(c.sdpFmtpLine ?? '') ? 0 : 1;
  const codecs = [...caps.codecs].sort((a, b) => rank(a) - rank(b));
  if (rank(codecs[0]) === 2) return; // este navegador no tiene VP9
  for (const t of pc.getTransceivers()) {
    if (t.sender.track?.kind !== 'video') continue;
    try {
      t.setCodecPreferences(codecs);
    } catch (err) {
      console.warn('[webrtc] no se pudo preferir VP9; se usa el códec por defecto', err);
    }
  }
}

/**
 * Ajusta cómo se envía el video a UN espectador:
 * - tope de velocidad según la calidad elegida;
 * - qué cuidar si falta red o compu (fluidez o nitidez) según el tipo de contenido.
 */
export async function tuneVideoSender(pc: RTCPeerConnection, q: Quality, c: ContentType): Promise<void> {
  for (const sender of pc.getSenders()) {
    if (sender.track?.kind !== 'video') continue;
    // degradationPreference aún no está en los tipos de TypeScript
    const params = sender.getParameters() as RTCRtpSendParameters & { degradationPreference?: string };
    if (!params.encodings?.length) continue;
    params.encodings[0].maxBitrate = QUALITY[q].maxBitrate;
    params.encodings[0].maxFramerate = 30;
    params.degradationPreference = CONTENT[c].degradation;
    await sender
      .setParameters(params)
      .catch((err) => console.warn('[webrtc] no se pudo ajustar la calidad', err));
  }
}

/**
 * "Reinicia" el ajuste automático de calidad de Chrome para esta conexión.
 *
 * Al empezar, Chrome aún no sabe cuánta red hay y envía el video muy pequeño
 * (p. ej. 320x180 a 10 fps). A veces se queda ahí aunque luego sobre red.
 * Pasar un momento por "balanced" y volver al modo elegido hace que Chrome borre
 * sus límites y vuelva a calcular (probado: pasa a 1280x720 a 30 fps en ~2 s
 * cuando hay red suficiente).
 */
export async function refreshAdaptation(pc: RTCPeerConnection, c: ContentType): Promise<void> {
  const mode = CONTENT[c].degradation;
  const temp: Degradation = mode === 'balanced' ? 'maintain-resolution' : 'balanced';
  for (const sender of pc.getSenders()) {
    if (sender.track?.kind !== 'video') continue;
    for (const m of [temp, mode]) {
      const params = sender.getParameters() as RTCRtpSendParameters & { degradationPreference?: string };
      params.degradationPreference = m;
      await sender
        .setParameters(params)
        .catch((err) => console.warn('[webrtc] no se pudo reiniciar la calidad', err));
    }
  }
}

export interface SendStats {
  height: number | null; // alto en píxeles del video que se está enviando (p. ej. 720)
  fps: number | null;
  bytesSent: number;
  timestamp: number; // ms
  limitedBy: 'cpu' | 'bandwidth' | 'other' | 'none';
  availableKbps: number | null; // red que Chrome calcula que hay disponible hacia ese espectador
  codec: string | null; // p. ej. 'VP9' o 'VP8'
  // Lo que Chrome CAPTURA de la pestaña (antes de enviarlo). Sirve para saber si
  // el video sale chico desde el origen o si se achica al enviarlo.
  sourceWidth: number | null;
  sourceHeight: number | null;
  sourceFps: number | null;
}

/** Cómo se está enviando el video por esta conexión ahora mismo. */
export async function getSendStats(pc: RTCPeerConnection): Promise<SendStats | null> {
  const stats = await pc.getStats();
  let availableKbps: number | null = null;
  // RTCStats genéricos: TypeScript no conoce todos los campos de cada tipo
  let outbound: Record<string, unknown> | undefined;
  stats.forEach((s) => {
    if (s.type === 'candidate-pair' && s.nominated && s.state === 'succeeded' && s.availableOutgoingBitrate) {
      availableKbps = Math.round(s.availableOutgoingBitrate / 1000);
    }
    if (s.type === 'outbound-rtp' && s.kind === 'video') outbound = s;
  });
  if (!outbound) return null;
  const o = outbound as {
    frameHeight?: number;
    framesPerSecond?: number;
    bytesSent?: number;
    timestamp: number;
    qualityLimitationReason?: SendStats['limitedBy'];
    codecId?: string;
    mediaSourceId?: string;
  };
  const codec = o.codecId ? (stats.get(o.codecId)?.mimeType as string | undefined) : undefined;
  const source = o.mediaSourceId ? stats.get(o.mediaSourceId) : undefined;
  return {
    height: o.frameHeight ?? null,
    fps: o.framesPerSecond ?? null,
    bytesSent: o.bytesSent ?? 0,
    timestamp: o.timestamp,
    limitedBy: o.qualityLimitationReason ?? 'none',
    availableKbps,
    codec: codec ? codec.replace(/^video\//i, '') : null,
    sourceWidth: source?.width ?? null,
    sourceHeight: source?.height ?? null,
    sourceFps: source?.framesPerSecond ?? null,
  };
}

/**
 * Audio en ESTÉREO y con más calidad (hasta 128 kbps) para películas y música.
 * Por defecto Chrome manda el audio Opus en mono a ~32 kbps. Se agregan los parámetros
 * "stereo" y "maxaveragebitrate" a las líneas de Opus del SDP:
 * - en la descripción REMOTA del que envía: así sabe que puede mandar estéreo;
 * - en la respuesta LOCAL del que recibe: así lo reproduce en estéreo.
 */
export function opusStereo(sdp: string): string {
  const opus = [...sdp.matchAll(/^a=rtpmap:(\d+) opus\/48000\/2\r?$/gim)].map((m) => m[1]);
  let out = sdp;
  for (const pt of opus) {
    out = out.replace(new RegExp(`^(a=fmtp:${pt} [^\r\n]*)`, 'gm'), (line) => {
      let l = line;
      if (!/[; ]stereo=1/.test(l)) l += ';stereo=1';
      if (!/sprop-stereo=1/.test(l)) l += ';sprop-stereo=1';
      if (!/maxaveragebitrate=/.test(l)) l += ';maxaveragebitrate=128000';
      return l;
    });
  }
  return out;
}

export type Route = 'direct' | 'relay';

/**
 * ¿Por dónde va el video de esta conexión ahora mismo?
 * 'relay' = pasa por el servidor TURN; 'direct' = conexión directa. null si aún no se sabe.
 */
export async function getRoute(pc: RTCPeerConnection): Promise<Route | null> {
  const stats = await pc.getStats();
  let pair: RTCIceCandidatePairStats | undefined;
  stats.forEach((s) => {
    if (s.type === 'transport' && s.selectedCandidatePairId) pair = stats.get(s.selectedCandidatePairId);
  });
  // Algunos navegadores no informan "transport": buscamos el par elegido a mano
  if (!pair) {
    stats.forEach((s) => {
      if (s.type === 'candidate-pair' && s.nominated && s.state === 'succeeded') pair = s;
    });
  }
  if (!pair) return null;
  const local = stats.get(pair.localCandidateId);
  const remote = stats.get(pair.remoteCandidateId);
  return local?.candidateType === 'relay' || remote?.candidateType === 'relay' ? 'relay' : 'direct';
}
