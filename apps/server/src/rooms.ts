// Manejo de salas EN MEMORIA (se pierden al reiniciar el servidor).
import { randomInt } from 'node:crypto';
import {
  MAX_PEOPLE_PER_ROOM,
  ROOM_CODE_LENGTH,
  type ChatMessage,
  type Participant,
} from '@lazo/shared';

export interface Room {
  code: string;
  hostId: string;
  participants: Map<string, Participant>; // clave = id del socket
  history: ChatMessage[]; // últimos mensajes, para quien entra tarde
}

const rooms = new Map<string, Room>();

// Sin letras/números que se confundan (0/O, 1/I/L)
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const MAX_HISTORY = 50;

// Genera un código aleatorio con crypto (más seguro que Math.random)
function newCode(): string {
  let code: string;
  do {
    code = '';
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) code += ALPHABET[randomInt(ALPHABET.length)];
  } while (rooms.has(code));
  return code;
}

export function createRoom(host: Participant): Room {
  const room: Room = {
    code: newCode(),
    hostId: host.id,
    participants: new Map([[host.id, host]]),
    history: [],
  };
  rooms.set(room.code, room);
  return room;
}

export function getRoom(code: string): Room | undefined {
  return rooms.get(code);
}

/** ¿La sala tiene anfitrión ahora mismo? */
export function hasHost(room: Room): boolean {
  return [...room.participants.values()].some((p) => p.role === 'host');
}

/** Intenta añadir a alguien. Devuelve un mensaje de error o null si todo bien. */
export function addParticipant(room: Room, p: Participant): string | null {
  if (room.participants.size >= MAX_PEOPLE_PER_ROOM) return 'La sala está llena';
  room.participants.set(p.id, p);
  if (p.role === 'host') room.hostId = p.id;
  return null;
}

/** Quita a alguien. Si la sala queda vacía, se borra. */
export function removeParticipant(room: Room, socketId: string): void {
  room.participants.delete(socketId);
  if (room.participants.size === 0) rooms.delete(room.code);
}

export function addMessage(room: Room, msg: ChatMessage): void {
  room.history.push(msg);
  if (room.history.length > MAX_HISTORY) room.history.shift();
}

export function listParticipants(room: Room): Participant[] {
  return [...room.participants.values()];
}

export function roomCount(): number {
  return rooms.size;
}
