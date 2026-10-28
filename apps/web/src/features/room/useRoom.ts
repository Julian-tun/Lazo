// Hook con el estado de la sala: quién soy, quién está y los mensajes.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatMessage, JoinedData, Participant } from '@lazo/shared';
import { ACK_TIMEOUT_MS, clearSession, loadSession, saveSession, socket } from '../../lib/socket';

export function useRoom(code: string, initial: JoinedData | null) {
  const [me, setMe] = useState<Participant | null>(initial?.me ?? null);
  const [participants, setParticipants] = useState<Participant[]>(initial?.participants ?? []);
  const [messages, setMessages] = useState<ChatMessage[]>(initial?.history ?? []);
  const [error, setError] = useState<string | null>(null);

  // Guardamos en refs lo que necesitan los listeners de socket sin re-registrarse.
  // El nombre viene de Home o, si recargaste la página, de la sesión de esta pestaña.
  const session = loadSession();
  const nameRef = useRef<string | null>(
    initial?.me.name ?? (session?.code === code ? session.name : null),
  );
  const meRef = useRef(me);
  meRef.current = me;

  const join = useCallback(
    async (name: string): Promise<boolean> => {
      try {
        const r = await socket.timeout(ACK_TIMEOUT_MS).emitWithAck('room:join', { code, name });
        if (!r.ok) {
          setError(r.error);
          return false;
        }
        nameRef.current = name;
        saveSession(code, name);
        setMe(r.data.me);
        setParticipants(r.data.participants);
        setMessages(r.data.history);
        setError(null);
        return true;
      } catch {
        setError('El servidor no respondió. Intenta de nuevo.');
        return false;
      }
    },
    [code],
  );

  useEffect(() => {
    const onPresence = (p: { code: string; participants: Participant[] }) => {
      if (p.code === code) setParticipants(p.participants);
    };
    const onMessage = (m: ChatMessage) => setMessages((prev) => [...prev, m].slice(-200));

    // Si el socket cambió (reconexión o recarga de página), el servidor ya no nos
    // tiene en la sala: volvemos a entrar con el mismo nombre.
    const ensureJoined = () => {
      if (nameRef.current && socket.connected && meRef.current?.id !== socket.id) {
        void join(nameRef.current);
      }
    };

    socket.on('presence', onPresence);
    socket.on('chat:message', onMessage);
    socket.on('connect', ensureJoined);
    ensureJoined();
    return () => {
      socket.off('presence', onPresence);
      socket.off('chat:message', onMessage);
      socket.off('connect', ensureJoined);
    };
  }, [code, join]);

  const leave = useCallback(() => {
    nameRef.current = null;
    clearSession();
    socket.emit('room:leave');
  }, []);

  /** Envía un mensaje. Devuelve un texto de error o null si salió bien. */
  const sendMessage = useCallback(async (text: string): Promise<string | null> => {
    try {
      const r = await socket.timeout(ACK_TIMEOUT_MS).emitWithAck('chat:message', { text });
      return r.ok ? null : r.error;
    } catch {
      return 'No se pudo enviar (sin conexión)';
    }
  }, []);

  // Estamos entrando solos (recarga o reconexión) y aún no hay respuesta
  const autoJoining = !me && !!nameRef.current && !error;

  return { me, participants, messages, error, autoJoining, join, leave, sendMessage };
}
