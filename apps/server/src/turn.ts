// Servidores ICE para WebRTC: STUN siempre y, si está configurado, TURN de Cloudflare.
//
// TURN es un "intermediario" que solo se usa si la conexión directa falla
// (redes estrictas, datos móviles, otro país). WebRTC siempre prueba primero
// la conexión directa; el TURN queda de respaldo.
//
// La clave de Cloudflare se queda en el servidor. A los navegadores solo les damos
// credenciales TEMPORALES generadas con esa clave.
import type { IceConfig } from '@lazo/shared';

const STUN: RTCIceServer = { urls: 'stun:stun.l.google.com:19302' };
const TTL_SECONDS = 24 * 60 * 60; // las credenciales duran 24 h

let cache: { servers: RTCIceServer[]; expiresAt: number } | null = null;

// Se leen al usarse (no al importar) para que el archivo .env ya esté cargado
const keyId = () => process.env.CLOUDFLARE_TURN_KEY_ID?.trim();
const apiToken = () => process.env.CLOUDFLARE_TURN_API_TOKEN?.trim();

export function turnConfigured(): boolean {
  return Boolean(keyId() && apiToken());
}

/** Quita las URLs del puerto 53: muchos navegadores las bloquean y solo hacen perder tiempo. */
function withoutPort53(server: RTCIceServer): RTCIceServer {
  const urls = (Array.isArray(server.urls) ? server.urls : [server.urls]).filter((u) => !/:53(\?|$)/.test(u));
  return { ...server, urls };
}

/** Servidores ICE (el campo "sfu" lo agrega socket.ts). */
export async function getIceConfig(): Promise<Omit<IceConfig, 'sfu'>> {
  if (!turnConfigured()) return { iceServers: [STUN], turn: false };
  if (cache && Date.now() < cache.expiresAt) return { iceServers: cache.servers, turn: true };

  try {
    const res = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${keyId()}/credentials/generate-ice-servers`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ttl: TTL_SECONDS }),
      },
    );
    if (!res.ok) throw new Error(`Cloudflare respondió HTTP ${res.status}`);
    const body = (await res.json()) as { iceServers?: RTCIceServer | RTCIceServer[] };
    const list = Array.isArray(body.iceServers) ? body.iceServers : body.iceServers ? [body.iceServers] : [];
    const servers = list.map(withoutPort53).filter((s) => (s.urls as string[]).length > 0);
    if (!servers.some((s) => (s.urls as string[]).some((u) => u.startsWith('turn')))) {
      throw new Error('la respuesta no trae servidores TURN');
    }

    // Renovamos a mitad de su vida, para no repartir credenciales a punto de vencer
    cache = { servers: [STUN, ...servers], expiresAt: Date.now() + (TTL_SECONDS / 2) * 1000 };
    return { iceServers: cache.servers, turn: true };
  } catch (err) {
    console.error('[turn] No se pudieron obtener credenciales TURN; se usará solo conexión directa.', err);
    return { iceServers: [STUN], turn: false };
  }
}
