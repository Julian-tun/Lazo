// Utilidades WebRTC: conexiones P2P entre el anfitrión y cada espectador.
// El video/audio va directo entre los navegadores; el servidor solo pasa
// los mensajes de "señalización" (offer / answer / ice).
import type { IceConfig } from '@lazo/shared';
import { ACK_TIMEOUT_MS, socket } from './socket';

// Si no se puede pedir la configuración al servidor: solo STUN (conexión directa)
const FALLBACK: IceConfig = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
  turn: false,
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

export const QUALITY: Record<Quality, { label: string; width: number; height: number; maxBitrate: number }> = {
  ahorro: { label: 'Ahorro (480p)', width: 854, height: 480, maxBitrate: 800_000 },
  normal: { label: 'Normal (720p)', width: 1280, height: 720, maxBitrate: 2_500_000 },
  alta: { label: 'Alta (1080p)', width: 1920, height: 1080, maxBitrate: 5_000_000 },
};

/** Límites de captura para la pestaña compartida según la calidad elegida. */
export function captureConstraints(q: Quality): MediaTrackConstraints {
  const { width, height } = QUALITY[q];
  return { width: { max: width }, height: { max: height }, frameRate: { max: 30 } };
}

/**
 * Ajusta cómo se envía el video a UN espectador:
 * - tope de velocidad según la calidad elegida;
 * - "balanced": si falta red o compu, baja un poco la fluidez Y un poco la nitidez,
 *   en vez de dejar la imagen muy pequeña.
 */
export async function tuneVideoSender(pc: RTCPeerConnection, q: Quality): Promise<void> {
  for (const sender of pc.getSenders()) {
    if (sender.track?.kind !== 'video') continue;
    // degradationPreference aún no está en los tipos de TypeScript
    const params = sender.getParameters() as RTCRtpSendParameters & { degradationPreference?: string };
    if (!params.encodings?.length) continue;
    params.encodings[0].maxBitrate = QUALITY[q].maxBitrate;
    params.encodings[0].maxFramerate = 30;
    params.degradationPreference = 'balanced';
    await sender.setParameters(params).catch((err) => console.warn('[webrtc] no se pudo ajustar la calidad', err));
  }
}

/**
 * "Reinicia" el ajuste automático de calidad de Chrome para esta conexión.
 *
 * Al empezar, Chrome aún no sabe cuánta red hay y envía el video muy pequeño
 * (p. ej. 320x180 a 10 fps). A veces se queda ahí aunque luego sobre red.
 * Cambiar el modo y volver a "balanced" hace que vuelva a calcular (probado:
 * pasa a 1280x720 a 30 fps en ~2 s cuando hay red suficiente).
 */
export async function refreshAdaptation(pc: RTCPeerConnection): Promise<void> {
  for (const sender of pc.getSenders()) {
    if (sender.track?.kind !== 'video') continue;
    for (const mode of ['maintain-resolution', 'balanced'] as const) {
      const params = sender.getParameters();
      params.degradationPreference = mode;
      await sender.setParameters(params).catch((err) => console.warn('[webrtc] no se pudo reiniciar la calidad', err));
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
}

/** Cómo se está enviando el video por esta conexión ahora mismo. */
export async function getSendStats(pc: RTCPeerConnection): Promise<SendStats | null> {
  const stats = await pc.getStats();
  let out: SendStats | null = null;
  let availableKbps: number | null = null;
  stats.forEach((s) => {
    if (s.type === 'candidate-pair' && s.nominated && s.state === 'succeeded' && s.availableOutgoingBitrate) {
      availableKbps = Math.round(s.availableOutgoingBitrate / 1000);
    }
    if (s.type === 'outbound-rtp' && s.kind === 'video') {
      out = {
        height: s.frameHeight ?? null,
        fps: s.framesPerSecond ?? null,
        bytesSent: s.bytesSent ?? 0,
        timestamp: s.timestamp,
        limitedBy: s.qualityLimitationReason ?? 'none',
        availableKbps: null,
      };
    }
  });
  if (out) (out as SendStats).availableKbps = availableKbps;
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
