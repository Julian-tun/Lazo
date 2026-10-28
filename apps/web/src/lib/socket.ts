// Conexión única de Socket.IO para toda la app.
import { useEffect, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@duo/shared';

export type DuoSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

// Sin URL: se conecta al mismo origen de la página.
// En desarrollo, Vite reenvía /socket.io al servidor (ver vite.config.ts).
export const socket: DuoSocket = io();

/** Tiempo máximo de espera para las respuestas del servidor. */
export const ACK_TIMEOUT_MS = 8000;

export type ConnectionState = 'connected' | 'reconnecting';

/** Hook: devuelve si estamos conectados al servidor o intentando reconectar. */
export function useConnectionState(): ConnectionState {
  const [state, setState] = useState<ConnectionState>(socket.connected ? 'connected' : 'reconnecting');
  useEffect(() => {
    const onConnect = () => setState('connected');
    const onDisconnect = () => setState('reconnecting');
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, []);
  return state;
}

// ---- Nombre recordado en este navegador ----
const NAME_KEY = 'duo:name';

export function loadName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveName(name: string) {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    // modo privado o almacenamiento bloqueado: no pasa nada
  }
}

// ---- Sala actual de esta pestaña (para volver a entrar solo al recargar) ----
const SESSION_KEY = 'duo:session';

export function loadSession(): { code: string; name: string } | null {
  try {
    return JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? 'null');
  } catch {
    return null;
  }
}

export function saveSession(code: string, name: string) {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ code, name }));
  } catch {
    // sin almacenamiento: al recargar se pedirá el nombre otra vez
  }
}

export function clearSession() {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // nada que limpiar
  }
}
