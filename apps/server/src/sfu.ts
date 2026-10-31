// Cliente del SFU de Cloudflare (Realtime SFU).
//
// SFU = "servidor intermedio de video": el anfitrión sube su video UNA sola vez a
// Cloudflare y Cloudflare lo reparte a cada espectador desde un servidor cercano a él.
//
// Cada navegador tiene UNA conexión WebRTC con Cloudflare, y cada conexión es una
// "sesión" del SFU (sessionId). El anfitrión "publica" sus pistas (audio y video) en su
// sesión; cada espectador "recibe" esas pistas en su propia sesión.
//
// El App Secret se queda en el servidor: los navegadores nunca lo ven.
// Documentación: https://developers.cloudflare.com/realtime/sfu/
import type { SfuLayer } from '@lazo/shared';

const API = 'https://rtc.live.cloudflare.com/v1/apps';
const TIMEOUT_MS = 10_000; // si Cloudflare no contesta en 10 s, lo damos por fallido

// Se leen al usarse (no al importar) para que el archivo .env ya esté cargado
const appId = () => process.env.CLOUDFLARE_SFU_APP_ID?.trim();
const appSecret = () => process.env.CLOUDFLARE_SFU_APP_SECRET?.trim();

export function sfuConfigured(): boolean {
  return Boolean(appId() && appSecret());
}

interface ApiTrack {
  location?: 'local' | 'remote';
  mid?: string;
  sessionId?: string;
  trackName?: string;
  errorCode?: string;
  errorDescription?: string;
}

interface ApiResponse {
  errorCode?: string;
  errorDescription?: string;
  sessionId?: string;
  sessionDescription?: RTCSessionDescriptionInit;
  requiresImmediateRenegotiation?: boolean;
  tracks?: ApiTrack[];
}

/** Llama a la API del SFU. Lanza un error si falla (HTTP, error general o error de alguna pista). */
async function call(method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown): Promise<ApiResponse> {
  const res = await fetch(`${API}/${appId()}${path}`, {
    method,
    headers: { Authorization: `Bearer ${appSecret()}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  let data: ApiResponse = {};
  try {
    data = text ? (JSON.parse(text) as ApiResponse) : {};
  } catch {
    // respuesta que no es JSON: nos quedamos con el código HTTP
  }
  // Nombre corto de la operación para los mensajes (sin ids ni claves)
  const op = path.replace(/\/sessions\/[^/]+/, '/sessions/…');
  if (!res.ok || data.errorCode) {
    throw new Error(
      `SFU ${op}: HTTP ${res.status} ${data.errorCode ?? ''} ${data.errorDescription ?? ''}`.trim(),
    );
  }
  // Un 200 puede traer errores en pistas concretas: hay que revisarlas una por una
  const bad = data.tracks?.find((t) => t.errorCode);
  if (bad)
    throw new Error(`SFU ${op}: pista con error ${bad.errorCode} ${bad.errorDescription ?? ''}`.trim());
  return data;
}

/** Crea una sesión vacía (una por cada conexión de navegador). Hay que usarla enseguida: caduca. */
export async function newSession(): Promise<string> {
  const data = await call('POST', '/sessions/new');
  if (!data.sessionId) throw new Error('SFU /sessions/new: la respuesta no trae sessionId');
  return data.sessionId;
}

/**
 * El ANFITRIÓN publica sus pistas. Recibe su oferta (ya con los candidatos ICE)
 * y devuelve la respuesta del SFU, que el navegador aplica con setRemoteDescription.
 */
export async function publishTracks(
  sessionId: string,
  offer: RTCSessionDescriptionInit,
  tracks: { mid: string; trackName: string }[],
): Promise<RTCSessionDescriptionInit> {
  const data = await call('POST', `/sessions/${sessionId}/tracks/new`, {
    sessionDescription: offer,
    tracks: tracks.map((t) => ({ location: 'local', mid: t.mid, trackName: t.trackName })),
  });
  if (data.sessionDescription?.type !== 'answer') {
    throw new Error('SFU publicar: la respuesta no trae el "answer" del SFU');
  }
  return data.sessionDescription;
}

/**
 * Simulcast: el SFU manda SIEMPRE la capa que pidió el espectador.
 * - priorityOrdering 'none': probado que con 'asciibetical' Cloudflare se queda en la capa
 *   media (360p) aunque sobre red. Por eso la calidad la decide el ESPECTADOR: mide su
 *   conexión y pide otra capa con 'sfu:layer' (ver la web).
 * - ridNotAvailable 'asciibetical': si el anfitrión deja de enviar esa capa (p. ej. le falta
 *   subida), el SFU pasa a la siguiente que exista, en orden f -> h -> q.
 */
const simulcast = (layer: SfuLayer) => ({
  preferredRid: layer,
  priorityOrdering: 'none',
  ridNotAvailable: 'asciibetical',
});

/**
 * Un ESPECTADOR pide recibir las pistas de la publicación del anfitrión.
 * El SFU devuelve una OFERTA que el navegador debe contestar (ver renegotiate).
 */
export async function pullTracks(
  sessionId: string,
  publisherSessionId: string,
  tracks: { trackName: string; kind: 'audio' | 'video' }[],
  layer: SfuLayer,
): Promise<{ offer: RTCSessionDescriptionInit; tracks: { mid: string; trackName: string }[] }> {
  const data = await call('POST', `/sessions/${sessionId}/tracks/new`, {
    tracks: tracks.map((t) => ({
      location: 'remote',
      sessionId: publisherSessionId,
      trackName: t.trackName,
      ...(t.kind === 'video' ? { simulcast: simulcast(layer) } : {}),
    })),
  });
  if (!data.requiresImmediateRenegotiation || data.sessionDescription?.type !== 'offer') {
    throw new Error('SFU recibir: la respuesta no trae la oferta del SFU');
  }
  const out = (data.tracks ?? []).filter((t): t is ApiTrack & { mid: string; trackName: string } =>
    Boolean(t.mid && t.trackName),
  );
  if (out.length !== tracks.length) throw new Error('SFU recibir: faltan pistas en la respuesta');
  return { offer: data.sessionDescription, tracks: out.map((t) => ({ mid: t.mid, trackName: t.trackName })) };
}

/** El espectador contesta la oferta del SFU. Solo cuando esto termina bien, la operación acabó. */
export async function renegotiate(sessionId: string, answer: RTCSessionDescriptionInit): Promise<void> {
  await call('PUT', `/sessions/${sessionId}/renegotiate`, { sessionDescription: answer });
}

/** Cambia la capa de video (f / h / q) que recibe un espectador, sin reconectar. */
export async function changeLayer(
  sessionId: string,
  mid: string,
  publisherSessionId: string,
  trackName: string,
  layer: SfuLayer,
): Promise<void> {
  await call('PUT', `/sessions/${sessionId}/tracks/update`, {
    tracks: [
      { location: 'remote', sessionId: publisherSessionId, trackName, mid, simulcast: simulcast(layer) },
    ],
  });
}

/**
 * Cierra pistas de una sesión sin intercambio SDP ("force"). Se usa al dejar de compartir
 * o al salir. Nunca lanza error: si falla, solo lo anota (Cloudflare las cierra solo
 * a los 30 s sin datos).
 */
export async function closeTracks(sessionId: string, mids: string[]): Promise<void> {
  if (mids.length === 0) return;
  try {
    await call('PUT', `/sessions/${sessionId}/tracks/close`, {
      tracks: mids.map((mid) => ({ mid })),
      force: true,
    });
  } catch (err) {
    console.warn('[sfu] no se pudieron cerrar pistas (se cerrarán solas):', (err as Error).message);
  }
}
