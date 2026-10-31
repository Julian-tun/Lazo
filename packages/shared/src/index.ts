// Tipos y constantes compartidos entre el servidor y la web.
// Si cambias un evento aquí, TypeScript te avisará en ambos lados.

// ---- Límites ----
export const MAX_NAME_LENGTH = 30;
export const MAX_MESSAGE_LENGTH = 500;
export const MAX_PEOPLE_PER_ROOM = 4; // 1 anfitrión + 3 espectadores
export const ROOM_CODE_LENGTH = 8;

// ---- Modelos ----
export type Role = 'host' | 'guest';

export interface Participant {
  id: string; // id del socket
  name: string;
  role: Role;
}

export interface ChatMessage {
  id: string;
  fromId: string;
  name: string;
  text: string;
  at: number; // marca de tiempo (ms)
}

export interface PresencePayload {
  code: string;
  participants: Participant[];
}

// Respuesta genérica de los "acks" (callbacks) de Socket.IO
export type Ack<T = undefined> =
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- {} = "no agrega nada" (sin data)
  ({ ok: true } & (T extends undefined ? {} : { data: T })) | { ok: false; error: string };

// Cómo se ve la sala para todos. Lo decide el anfitrión y lo guarda el servidor
// (así no se pierde aunque el chat se llene de mensajes).
export type RoomTheme = 'normal' | 'fiamma'; // fiamma = tema rosita 🌸
export const ROOM_THEMES: readonly RoomTheme[] = ['normal', 'fiamma'];
export interface RoomLook {
  theme: RoomTheme;
  party: boolean; // modo fiesta 🎂: canción, felicitaciones y guirnalda
}

export interface JoinedData {
  code: string;
  me: Participant;
  participants: Participant[];
  history: ChatMessage[];
  look: RoomLook;
}

// Señalización WebRTC: el servidor solo reenvía estos datos al otro participante.
// callId identifica cada intento de conexión, para ignorar mensajes de intentos viejos.
export interface SignalOffer {
  callId: string;
  sdp: RTCSessionDescriptionInit;
}
export interface SignalAnswer {
  callId: string;
  sdp: RTCSessionDescriptionInit;
}
export interface SignalIce {
  callId: string;
  candidate: RTCIceCandidateInit;
}

// Configuración de red para WebRTC que da el servidor
export interface IceConfig {
  iceServers: RTCIceServer[];
  turn: boolean; // true si hay respaldo TURN disponible
  sfu: boolean; // true si el SFU de Cloudflare está configurado en el servidor
}

// ---- SFU de Cloudflare ----
// El anfitrión sube el video UNA vez a Cloudflare y Cloudflare lo reparte a cada espectador.
// El video va en 3 capas (simulcast): f = completa, h = mitad, q = cuarto.
export type SfuLayer = 'f' | 'h' | 'q';
export const SFU_LAYERS: SfuLayer[] = ['f', 'h', 'q'];

export interface SfuTrack {
  mid: string; // id del "transceiver" en la conexión del navegador
  kind: 'audio' | 'video';
}
export interface SfuPublishData {
  pubId: string; // id de esta publicación (cambia cada vez que el anfitrión vuelve a compartir)
  sdp: RTCSessionDescriptionInit; // respuesta del SFU para el anfitrión
}
/** Lo que un espectador recibe del SFU (se lo manda al anfitrión para su panel). */
export interface SfuStats {
  layer: SfuLayer; // capa que recibe
  auto: boolean; // true si la calidad está en "Auto"
  height: number | null; // alto en píxeles
  fps: number;
  lossPct: number; // % de paquetes perdidos en los últimos segundos
}
export interface SfuSubscribeData {
  pubId: string;
  sdp: RTCSessionDescriptionInit; // oferta del SFU para el espectador
  tracks: SfuTrack[]; // qué mid es el audio y cuál el video en la conexión del espectador
}

// ---- Eventos ----
// Eventos que el CLIENTE envía al servidor
export interface ClientToServerEvents {
  'room:create': (p: { name: string }, ack: (r: Ack<JoinedData>) => void) => void;
  'room:join': (p: { code: string; name: string }, ack: (r: Ack<JoinedData>) => void) => void;
  'room:leave': () => void;
  'chat:message': (p: { text: string }, ack: (r: Ack) => void) => void;
  // (Solo anfitrión) cambia el tema y/o el modo fiesta para todos
  'room:look': (p: Partial<RoomLook>, ack: (r: Ack) => void) => void;
  // El anfitrión tiene una conexión por invitado: "to" dice a qué invitado va.
  'webrtc:offer': (p: SignalOffer & { to: string }) => void;
  // El invitado siempre habla con el anfitrión (el servidor sabe quién es).
  'webrtc:answer': (p: SignalAnswer) => void;
  // "to" es obligatorio si lo envía el anfitrión; el invitado no lo necesita.
  'webrtc:ice': (p: SignalIce & { to?: string }) => void;
  // El invitado pide el video. Si el anfitrión publica por el SFU, el servidor le contesta
  // con 'sfu:published'; si no (o si p2p = true), se le pasa al anfitrión para conexión directa.
  'webrtc:request': (p?: { p2p?: boolean }) => void;
  // El anfitrión avisa que dejó de compartir
  'webrtc:stop': () => void;
  // Pedir los servidores STUN/TURN (solo para quien está en una sala)
  'webrtc:config': (ack: (r: Ack<IceConfig>) => void) => void;

  // ---- SFU (anfitrión) ----
  // Publica sus pistas: manda su oferta y recibe la respuesta del SFU
  'sfu:publish': (
    p: { sdp: RTCSessionDescriptionInit; tracks: SfuTrack[] },
    ack: (r: Ack<SfuPublishData>) => void,
  ) => void;
  // Su conexión con el SFU ya está "connected": se avisa a los espectadores
  'sfu:live': (p: { pubId: string }) => void;
  // Dejó de publicar por el SFU (dejó de compartir o pasó a conexión directa)
  'sfu:unpublish': () => void;

  // ---- SFU (espectador) ----
  // Pide recibir la publicación actual en la capa "layer": recibe la oferta del SFU
  'sfu:subscribe': (p: { layer: SfuLayer }, ack: (r: Ack<SfuSubscribeData>) => void) => void;
  // Manda su respuesta a esa oferta
  'sfu:answer': (p: { pubId: string; sdp: RTCSessionDescriptionInit }, ack: (r: Ack) => void) => void;
  // Cambia la capa que recibe (f = completa, h = mitad, q = cuarto)
  'sfu:layer': (p: { layer: SfuLayer }, ack: (r: Ack) => void) => void;
  // Cómo le llega el video (cada pocos segundos): el servidor se lo pasa al anfitrión
  'sfu:stats': (p: SfuStats) => void;
}

// Eventos que el SERVIDOR envía al cliente
export interface ServerToClientEvents {
  presence: (p: PresencePayload) => void;
  'chat:message': (m: ChatMessage) => void;
  // El anfitrión cambió el tema o el modo fiesta
  'room:look': (p: RoomLook) => void;
  'webrtc:offer': (p: SignalOffer & { fromId: string }) => void;
  'webrtc:answer': (p: SignalAnswer & { fromId: string }) => void;
  'webrtc:ice': (p: SignalIce & { fromId: string }) => void;
  // p2p = true: este invitado pide conexión directa aunque haya SFU (el SFU le falló)
  'webrtc:request': (p: { fromId: string; p2p: boolean }) => void;
  'webrtc:stop': (p: { fromId: string }) => void;
  // Hay una publicación del anfitrión en el SFU lista para recibir
  'sfu:published': (p: { pubId: string }) => void;
  // Esa publicación terminó
  'sfu:unpublished': (p: { pubId: string }) => void;
  // (Solo al anfitrión) cómo le llega el video a un espectador por el SFU
  'sfu:stats': (p: SfuStats & { fromId: string }) => void;
}
