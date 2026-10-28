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

export interface JoinedData {
  code: string;
  me: Participant;
  participants: Participant[];
  history: ChatMessage[];
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
}

// ---- Eventos ----
// Eventos que el CLIENTE envía al servidor
export interface ClientToServerEvents {
  'room:create': (p: { name: string }, ack: (r: Ack<JoinedData>) => void) => void;
  'room:join': (p: { code: string; name: string }, ack: (r: Ack<JoinedData>) => void) => void;
  'room:leave': () => void;
  'chat:message': (p: { text: string }, ack: (r: Ack) => void) => void;
  // El anfitrión tiene una conexión por invitado: "to" dice a qué invitado va.
  'webrtc:offer': (p: SignalOffer & { to: string }) => void;
  // El invitado siempre habla con el anfitrión (el servidor sabe quién es).
  'webrtc:answer': (p: SignalAnswer) => void;
  // "to" es obligatorio si lo envía el anfitrión; el invitado no lo necesita.
  'webrtc:ice': (p: SignalIce & { to?: string }) => void;
  // El invitado pide al anfitrión que (re)inicie la conexión de video
  'webrtc:request': () => void;
  // El anfitrión avisa que dejó de compartir
  'webrtc:stop': () => void;
  // Pedir los servidores STUN/TURN (solo para quien está en una sala)
  'webrtc:config': (ack: (r: Ack<IceConfig>) => void) => void;
}

// Eventos que el SERVIDOR envía al cliente
export interface ServerToClientEvents {
  presence: (p: PresencePayload) => void;
  'chat:message': (m: ChatMessage) => void;
  'webrtc:offer': (p: SignalOffer & { fromId: string }) => void;
  'webrtc:answer': (p: SignalAnswer & { fromId: string }) => void;
  'webrtc:ice': (p: SignalIce & { fromId: string }) => void;
  'webrtc:request': (p: { fromId: string }) => void;
  'webrtc:stop': (p: { fromId: string }) => void;
}
