// Chat en tiempo real: lista de mensajes + caja para escribir.
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { MAX_MESSAGE_LENGTH, type ChatMessage } from '@lazo/shared';
import { Avatar } from '../../components/Avatar';

interface Props {
  messages: ChatMessage[];
  meId: string;
  onSend: (text: string) => Promise<string | null>;
  className?: string;
}

const formatTime = (at: number) =>
  new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

// Mensajes seguidos de la misma persona (en menos de 2 min) van juntos, sin repetir nombre
const GROUP_MS = 2 * 60_000;

export function ChatPanel({ messages, meId, onSend, className = '' }: Props) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // Solo se animan los mensajes que llegan después de abrir el chat (no el historial)
  const [firstCount] = useState(messages.length);

  // Bajar automáticamente al último mensaje
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    const err = await onSend(t);
    setError(err);
    if (!err) setText('');
  }

  return (
    <div className={`flex min-h-0 flex-col ${className}`}>
      <div ref={listRef} className="flex-1 overflow-y-auto px-3 py-4">
        {messages.length === 0 && (
          <div className="animate-fade-in flex flex-col items-center gap-3 pt-8 text-center text-sm text-zinc-500">
            <span className="grid size-12 place-items-center rounded-2xl border border-zinc-800 bg-zinc-900/60">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.6}
                className="size-6"
                aria-hidden
              >
                <path d="M7.5 18.5 4 20l1.2-3.5A7.5 7.5 0 1 1 7.5 18.5Z" strokeLinejoin="round" />
              </svg>
            </span>
            Aún no hay mensajes. ¡Saluda!
          </div>
        )}
        {messages.map((m, i) => {
          const mine = m.fromId === meId;
          const prev = messages[i - 1];
          // ¿Empieza un grupo nuevo? (otra persona, o pasó un rato)
          const first = !prev || prev.fromId !== m.fromId || m.at - prev.at > GROUP_MS;
          return (
            <div
              key={m.id}
              className={`flex items-end gap-2 ${mine ? 'flex-row-reverse' : ''} ${first ? 'mt-3 first:mt-0' : 'mt-1'} ${
                i >= firstCount ? 'animate-pop-in' : ''
              }`}
            >
              {/* Avatar solo en mensajes de otros, en el primero de cada grupo */}
              {!mine &&
                (first ? (
                  <Avatar name={m.name} className="size-7 text-xs" />
                ) : (
                  <span className="w-7 shrink-0" />
                ))}
              <div className={`flex max-w-[80%] flex-col ${mine ? 'items-end' : 'items-start'}`}>
                {first && (
                  <div className="mb-1 flex items-baseline gap-2 px-1 text-[11px] text-zinc-500">
                    <span className="font-medium text-zinc-300">{mine ? 'Tú' : m.name}</span>
                    <span>{formatTime(m.at)}</span>
                  </div>
                )}
                <p
                  className={`rounded-2xl px-3.5 py-2 text-sm leading-relaxed break-words whitespace-pre-wrap shadow-sm ${
                    mine
                      ? 'rounded-br-md bg-linear-to-br from-violet-500 to-violet-600 text-white'
                      : 'rounded-bl-md border border-zinc-800 bg-zinc-900 text-zinc-100'
                  }`}
                >
                  {m.text}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {error && <p className="animate-fade-in px-4 pb-1 text-xs text-red-300">{error}</p>}

      <form
        onSubmit={submit}
        className="flex items-center gap-2 border-t border-zinc-800/70 bg-zinc-950/40 p-2.5"
      >
        <input
          className="min-w-0 flex-1 rounded-full border border-zinc-800 bg-zinc-900/80 px-4 py-2.5 text-base transition outline-none placeholder:text-zinc-500 focus:border-violet-500 focus:ring-4 focus:ring-violet-500/15"
          value={text}
          maxLength={MAX_MESSAGE_LENGTH}
          placeholder="Escribe un mensaje…"
          enterKeyHint="send"
          onChange={(e) => setText(e.target.value)}
        />
        <button
          aria-label="Enviar"
          title="Enviar"
          disabled={!text.trim()}
          className="grid size-11 shrink-0 place-items-center rounded-full bg-linear-to-b from-violet-500 to-violet-600 text-white shadow-lg shadow-violet-600/25 transition hover:brightness-110 active:scale-90 disabled:opacity-40 disabled:shadow-none"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" className="size-5 translate-x-px" aria-hidden>
            <path d="M3.4 20.4 21 12 3.4 3.6l-.01 6.53L15 12 3.39 13.87z" />
          </svg>
        </button>
      </form>
    </div>
  );
}
