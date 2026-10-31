// Avisos flotantes de mensajes nuevos, para verlos encima del video
// (pantalla completa o celular en horizontal con el chat cerrado).
import { useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '@lazo/shared';
import { Avatar } from '../../components/Avatar';

interface Props {
  messages: ChatMessage[];
  meId: string;
  onOpen: () => void; // al tocar un aviso (para responder)
  className?: string;
}

const TOAST_MS = 7000; // cuánto dura cada aviso (igual que la animación en index.css)
const MAX_TOASTS = 3;

export function ChatToasts({ messages, meId, onOpen, className = '' }: Props) {
  const [toasts, setToasts] = useState<ChatMessage[]>([]);
  // Hora del último mensaje ya revisado: solo avisamos de los más nuevos
  const seenAt = useRef(messages.at(-1)?.at ?? 0);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    const fresh = messages.filter((m) => m.at > seenAt.current);
    if (fresh.length === 0) return;
    seenAt.current = fresh[fresh.length - 1].at;

    // No avisamos de nuestros propios mensajes
    const others = fresh.filter((m) => m.fromId !== meId);
    if (others.length === 0) return;
    setToasts((t) => [...t, ...others].slice(-MAX_TOASTS));
    for (const m of others) {
      timers.current.push(
        window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== m.id)), TOAST_MS),
      );
    }
  }, [messages, meId]);

  // Limpiar temporizadores al desmontar
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  if (toasts.length === 0) return null;

  return (
    // El contenedor deja pasar los toques al video; solo los avisos son tocables
    <div
      className={`pointer-events-none absolute bottom-14 left-3 z-10 flex max-w-[65%] flex-col items-start gap-1.5 ${className}`}
      aria-live="polite"
    >
      {toasts.map((m) => (
        <button
          key={m.id}
          onClick={onOpen}
          title="Toca para responder"
          className="animate-chat-toast pointer-events-auto flex items-start gap-2 rounded-2xl border border-white/10 bg-black/60 py-1.5 pr-3 pl-1.5 text-left text-sm text-white shadow-lg backdrop-blur-md"
        >
          <Avatar name={m.name} className="size-6 text-[11px]" />
          <span className="min-w-0 pt-0.5">
            <span className="font-semibold text-violet-300">{m.name}: </span>
            <span className="break-words">{m.text}</span>
          </span>
        </button>
      ))}
    </div>
  );
}
