// Conexión con el SFU de Cloudflare (servidor intermedio de video).
//
// El anfitrión sube su video UNA vez a Cloudflare, en 3 capas (simulcast):
//   f = completa, h = mitad del tamaño, q = un cuarto.
// Cloudflare reparte a cada espectador la capa que él pida según su internet.
// El navegador nunca habla directo con la API de Cloudflare: todo pasa por nuestro servidor.
import type { SfuLayer, SfuTrack } from '@lazo/shared';
import { socket } from './socket';
import { smoothPlayback } from './sfuQuality';
import { CONTENT, opusStereo, QUALITY, type ContentType, type Quality } from './webrtc';

// Cloudflare responde por la red de nuestro servidor: le damos un poco más de tiempo
const SFU_ACK_TIMEOUT_MS = 15_000;
const CONNECT_TIMEOUT_MS = 15_000;
const STUN_CLOUDFLARE: RTCIceServer = { urls: 'stun:stun.cloudflare.com:3478' };

/**
 * Las 3 capas del video según la calidad elegida.
 * La capa completa usa el tope de la calidad; las otras, una parte.
 */
export function simulcastEncodings(q: Quality): (RTCRtpEncodingParameters & { rid: SfuLayer })[] {
  const top = QUALITY[q].maxBitrate;
  return [
    { rid: 'f', scaleResolutionDownBy: 1, maxBitrate: top, maxFramerate: 30 },
    { rid: 'h', scaleResolutionDownBy: 2, maxBitrate: Math.round(top * 0.3), maxFramerate: 30 },
    { rid: 'q', scaleResolutionDownBy: 4, maxBitrate: Math.round(top * 0.1), maxFramerate: 30 },
  ];
}

/** Ajusta las 3 capas (velocidad máxima) y qué cuidar si falta red (fluidez o nitidez). */
export async function tuneSimulcast(pc: RTCPeerConnection, q: Quality, c: ContentType): Promise<void> {
  const wanted = simulcastEncodings(q);
  for (const sender of pc.getSenders()) {
    if (sender.track?.kind !== 'video') continue;
    // degradationPreference aún no está en los tipos de TypeScript
    const params = sender.getParameters() as RTCRtpSendParameters & { degradationPreference?: string };
    for (const enc of params.encodings ?? []) {
      const w = wanted.find((x) => x.rid === enc.rid);
      if (!w) continue;
      enc.maxBitrate = w.maxBitrate;
      enc.maxFramerate = w.maxFramerate;
    }
    params.degradationPreference = CONTENT[c].degradation;
    await sender
      .setParameters(params)
      .catch((err) => console.warn('[sfu] no se pudo ajustar la calidad', err));
  }
}

/** Espera a que el navegador junte sus candidatos ICE (máximo 3 s: con los que haya basta). */
export function waitIceGathering(pc: RTCPeerConnection): Promise<void> {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') return resolve();
    const done = () => {
      clearTimeout(timer);
      pc.removeEventListener('icegatheringstatechange', onChange);
      resolve();
    };
    const onChange = () => pc.iceGatheringState === 'complete' && done();
    const timer = setTimeout(done, 3000);
    pc.addEventListener('icegatheringstatechange', onChange);
  });
}

/** Espera a que la conexión quede "connected". Falla si se cae o tarda demasiado. */
export function waitConnected(pc: RTCPeerConnection): Promise<void> {
  return new Promise((resolve, reject) => {
    if (pc.connectionState === 'connected') return resolve();
    const finish = (err?: Error) => {
      clearTimeout(timer);
      pc.removeEventListener('connectionstatechange', onChange);
      if (err) reject(err);
      else resolve();
    };
    const onChange = () => {
      if (pc.connectionState === 'connected') finish();
      else if (pc.connectionState === 'failed' || pc.connectionState === 'closed')
        finish(new Error(`conexión ${pc.connectionState}`));
    };
    const timer = setTimeout(() => finish(new Error('tardó demasiado en conectar')), CONNECT_TIMEOUT_MS);
    pc.addEventListener('connectionstatechange', onChange);
  });
}

/** Servidores ICE para hablar con Cloudflare: su STUN + los nuestros (incluido el TURN si hay). */
export function sfuIceServers(iceServers: RTCIceServer[]): RTCIceServer[] {
  return [STUN_CLOUDFLARE, ...iceServers];
}

/** Copia simple de una descripción SDP (Socket.IO no puede enviar el objeto del navegador). */
const plain = (d: RTCSessionDescription | null): RTCSessionDescriptionInit => ({
  type: d!.type,
  sdp: d!.sdp,
});

export interface SfuPublisher {
  pc: RTCPeerConnection;
  pubId: string;
  /** Cierra la conexión con Cloudflare (no avisa al servidor: eso lo hace quien la usa). */
  close(): void;
}

/**
 * ANFITRIÓN: publica la pestaña compartida en el SFU.
 * Video en 3 capas (VP8, que todos los celulares pueden ver) y audio en estéreo.
 * onFail se llama si, ya funcionando, la conexión con Cloudflare se cae del todo.
 * Lanza un error si no se pudo publicar (quien la llama usa entonces la conexión directa).
 */
export async function publishToSfu(
  stream: MediaStream,
  iceServers: RTCIceServer[],
  q: Quality,
  c: ContentType,
  onFail: () => void,
): Promise<SfuPublisher> {
  const pc = new RTCPeerConnection({ iceServers: sfuIceServers(iceServers), bundlePolicy: 'max-bundle' });
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    pc.onconnectionstatechange = null;
    pc.close();
  };

  try {
    const tracks: SfuTrack[] = [];
    const video = stream.getVideoTracks()[0];
    const audio = stream.getAudioTracks()[0];
    if (!video) throw new Error('no hay video que publicar');

    const vt = pc.addTransceiver(video, { direction: 'sendonly', sendEncodings: simulcastEncodings(q) });
    preferVp8(vt);
    const at = audio ? pc.addTransceiver(audio, { direction: 'sendonly' }) : null;

    await pc.setLocalDescription(await pc.createOffer());
    await waitIceGathering(pc);
    tracks.push({ mid: vt.mid!, kind: 'video' });
    if (at?.mid) tracks.push({ mid: at.mid, kind: 'audio' });

    const r = await socket
      .timeout(SFU_ACK_TIMEOUT_MS)
      .emitWithAck('sfu:publish', { sdp: plain(pc.localDescription), tracks });
    if (!r.ok) throw new Error(r.error);
    // Audio en estéreo y con más calidad (por defecto Chrome manda mono a ~32 kbps)
    await pc.setRemoteDescription({ type: 'answer', sdp: opusStereo(r.data.sdp.sdp ?? '') });
    await tuneSimulcast(pc, q, c);
    await waitConnected(pc);

    // Si después se cae del todo, avisamos para pasar a conexión directa
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') onFail();
    };
    socket.emit('sfu:live', { pubId: r.data.pubId });
    return { pc, pubId: r.data.pubId, close };
  } catch (err) {
    close();
    throw err;
  }
}

export interface SfuSubscriber {
  pc: RTCPeerConnection;
  pubId: string;
  stream: MediaStream; // audio + video que llegan de Cloudflare
  close(): void;
}

/**
 * ESPECTADOR: recibe la publicación actual del anfitrión desde el SFU, en la capa pedida.
 * onState avisa los cambios de la conexión ya establecida ('disconnected', 'connected', 'failed').
 * Lanza un error si no se pudo conectar (quien la llama pide entonces conexión directa).
 */
export async function subscribeFromSfu(
  layer: SfuLayer,
  iceServers: RTCIceServer[],
  onState: (state: RTCPeerConnectionState) => void,
): Promise<SfuSubscriber> {
  const r = await socket.timeout(SFU_ACK_TIMEOUT_MS).emitWithAck('sfu:subscribe', { layer });
  if (!r.ok) throw new Error(r.error);

  const pc = new RTCPeerConnection({ iceServers: sfuIceServers(iceServers), bundlePolicy: 'max-bundle' });
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    pc.onconnectionstatechange = null;
    pc.close();
  };

  try {
    await pc.setRemoteDescription(r.data.sdp);
    // Al aplicar la oferta ya existen las pistas que van a llegar: las juntamos en un stream
    const stream = new MediaStream(pc.getTransceivers().map((t) => t.receiver.track));
    smoothPlayback(pc); // colchón de reproducción para que no se trabe
    const answer = await pc.createAnswer();
    // Audio en estéreo: el que recibe también lo indica en su respuesta (ver opusStereo)
    await pc.setLocalDescription({ type: 'answer', sdp: opusStereo(answer.sdp ?? '') });
    await waitIceGathering(pc);
    const a = await socket
      .timeout(SFU_ACK_TIMEOUT_MS)
      .emitWithAck('sfu:answer', { pubId: r.data.pubId, sdp: plain(pc.localDescription) });
    if (!a.ok) throw new Error(a.error);
    await waitConnected(pc);
    pc.onconnectionstatechange = () => onState(pc.connectionState);
    return { pc, pubId: r.data.pubId, stream, close };
  } catch (err) {
    close();
    throw err;
  }
}

/** Pone VP8 primero: es el códec más probado para simulcast y lo ven todos los celulares. */
function preferVp8(t: RTCRtpTransceiver): void {
  const caps = RTCRtpReceiver.getCapabilities?.('video');
  if (!caps) return;
  const codecs = [...caps.codecs].sort(
    (a, b) =>
      Number(b.mimeType.toLowerCase() === 'video/vp8') - Number(a.mimeType.toLowerCase() === 'video/vp8'),
  );
  try {
    t.setCodecPreferences(codecs);
  } catch (err) {
    console.warn('[sfu] no se pudo preferir VP8; se usa el códec por defecto', err);
  }
}

export interface LayerStats {
  rid: SfuLayer;
  height: number | null;
  fps: number | null;
  limitedBy: 'cpu' | 'bandwidth' | 'other' | 'none';
  active: boolean;
}

/** Cómo se está enviando cada capa al SFU ahora mismo (y la captura y la red disponible). */
export async function getPublishStats(pc: RTCPeerConnection): Promise<{
  layers: LayerStats[];
  bytesSent: number;
  timestamp: number;
  availableKbps: number | null;
  source: { width: number; height: number; fps: number | null } | null;
}> {
  const stats = await pc.getStats();
  const layers: LayerStats[] = [];
  let bytesSent = 0;
  let timestamp = 0;
  let availableKbps: number | null = null;
  let source: { width: number; height: number; fps: number | null } | null = null;
  stats.forEach((s) => {
    if (s.type === 'candidate-pair' && s.nominated && s.state === 'succeeded' && s.availableOutgoingBitrate) {
      availableKbps = Math.round(s.availableOutgoingBitrate / 1000);
    }
    if (s.type === 'outbound-rtp' && s.kind === 'video' && s.rid) {
      layers.push({
        rid: s.rid as SfuLayer,
        height: s.frameHeight ?? null,
        fps: s.framesPerSecond ?? null,
        limitedBy: s.qualityLimitationReason ?? 'none',
        active: s.active !== false,
      });
      bytesSent += s.bytesSent ?? 0;
      timestamp = s.timestamp;
      const src = s.mediaSourceId ? stats.get(s.mediaSourceId) : undefined;
      if (!source && src?.width && src.height)
        source = { width: src.width, height: src.height, fps: src.framesPerSecond ?? null };
    }
  });
  layers.sort((a, b) => a.rid.localeCompare(b.rid));
  return { layers, bytesSent, timestamp, availableKbps, source };
}
