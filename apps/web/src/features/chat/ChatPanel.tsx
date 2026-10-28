// Chat en tiempo real: lista de mensajes + caja para escribir.
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { MAX_MESSAGE_LENGTH, type ChatMessage } from '@lazo/shared';

interface Props {
  messages: ChatMessage[];
  meId: string;
  onSend: (text: string) => Promise<string | null>;
  className?: string;
}

const formatTime = (at: number) =>
  new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export function ChatPanel({ messages, meId, onSend, className = '' }: Props) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

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
      <div ref={listRef} className="flex-1 space-y-2 overflow-y-auto p-3">
        {messages.length === 0 && (
          <p className="pt-4 text-center text-sm text-zinc-500">Aún no hay mensajes. ¡Saluda!</p>
        )}
        {messages.map((m) => {
          const mine = m.fromId === meId;
          return (
            <div key={m.id} className={`flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
              <div className="flex items-baseline gap-2 text-[11px] text-zinc-400">
                <span className="font-medium text-zinc-300">{m.name}</span>
                <span>{formatTime(m.at)}</span>
              </div>
              <p
                className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm break-words whitespace-pre-wrap ${
                  mine ? 'bg-violet-600 text-white' : 'bg-zinc-800 text-zinc-100'
                }`}
              >
                {m.text}
              </p>
            </div>
          );
        })}
      </div>

      {error && <p className="px-3 pb-1 text-xs text-red-300">{error}</p>}

      <form onSubmit={submit} className="flex gap-2 border-t border-zinc-800/80 p-2">
        <input
          className="min-w-0 flex-1 rounded-xl border border-zinc-800 bg-zinc-900/80 px-3 py-2 text-base outline-none focus:border-violet-500"
          value={text}
          maxLength={MAX_MESSAGE_LENGTH}
          placeholder="Escribe un mensaje…"
          enterKeyHint="send"
          onChange={(e) => setText(e.target.value)}
        />
        <button className="rounded-xl bg-violet-600 px-4 text-sm font-semibold text-white hover:bg-violet-500">
          Enviar
        </button>
      </form>
    </div>
  );
}
