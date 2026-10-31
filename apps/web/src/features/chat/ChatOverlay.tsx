// Chat encima del video (pantalla completa o celular en horizontal):
// - Cerrado: avisos de mensajes nuevos + botón 💬.
// - Abierto: mini chat transparente a la izquierda para responder sin girar el teléfono.
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { MAX_MESSAGE_LENGTH, type ChatMessage } from '@lazo/shared';
import { ChatToasts } from './ChatToasts';

interface Props {
  messages: ChatMessage[];
  meId: string;
  onSend: (text: string) => Promise<string | null>;
  className?: string;
}

const formatTime = (at: number) =>
  new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export function ChatOverlay({ messages, meId, onSend, className = '' }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div className={className}>
      {open ? (
        <QuickChat messages={messages} meId={meId} onSend={onSend} onClose={() => setOpen(false)} />
      ) : (
        <>
          <ChatToasts messages={messages} meId={meId} onOpen={() => setOpen(true)} />
          <button
            onClick={() => setOpen(true)}
            title="Abrir chat"
            aria-label="Abrir chat"
            className="glass-btn absolute bottom-3 left-3 z-10 size-11"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="size-5" aria-hidden>
              <path d="M12 3c5 0 9 3.6 9 8s-4 8-9 8c-1 0-2-.1-2.9-.4L4.5 20.5l1.3-3.8A7.6 7.6 0 0 1 3 11c0-4.4 4-8 9-8Z" />
            </svg>
          </button>
        </>
      )}
    </div>
  );
}

/** Panel pequeño y transparente. La caja de texto va ARRIBA para que el teclado no la tape. */
function QuickChat({ messages, meId, onSend, onClose }: Omit<Props, 'className'> & { onClose: () => void }) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // Espacio que ocupa el teclado del celular, para subir el panel y que no tape la caja
  const [keyboard, setKeyboard] = useState(0);
  // Orden normal: los más nuevos abajo
  const recent = messages.slice(-30);

  // Bajar automáticamente al último mensaje (al abrir, al llegar uno nuevo o al salir el teclado)
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, keyboard]);

  // visualViewport = la parte de la pantalla que queda visible cuando sale el teclado
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => setKeyboard(Math.max(0, window.innerHeight - vv.height - vv.offsetTop));
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    const err = await onSend(t);
    setError(err);
    if (!err) setText('');
  }

  return (
    <>
      {/* Capa invisible detrás del panel: tocar fuera del mini chat lo cierra */}
      <div className="absolute inset-0 z-20" onPointerDown={onClose} aria-hidden />

      <div
        className="animate-scale-in absolute top-2 left-2 z-30 flex w-[45%] max-w-xs origin-top-left flex-col gap-2 rounded-2xl border border-white/10 bg-black/55 p-2 text-white shadow-2xl backdrop-blur-md"
        style={{ bottom: 8 + keyboard }}
      >
        <button
          type="button"
          title="Cerrar chat"
          onClick={onClose}
          aria-label="Cerrar chat"
          className="absolute top-1.5 right-1.5 z-10 grid size-7 place-items-center rounded-full text-white/70 transition hover:bg-white/10 hover:text-white"
        >
          <svg viewBox="0 0 20 20" fill="currentColor" className="size-4" aria-hidden>
            <path d="M5.3 5.3a1 1 0 0 1 1.4 0L10 8.6l3.3-3.3a1 1 0 1 1 1.4 1.4L11.4 10l3.3 3.3a1 1 0 0 1-1.4 1.4L10 11.4l-3.3 3.3a1 1 0 0 1-1.4-1.4L8.6 10 5.3 6.7a1 1 0 0 1 0-1.4Z" />
          </svg>
        </button>

        {/* Mensajes pegados abajo, justo encima de la caja de texto */}
        <div ref={listRef} className="flex min-h-0 flex-1 flex-col overflow-y-auto pr-6 text-sm">
          <ul className="mt-auto space-y-1">
            {recent.map((m) => (
              <li key={m.id} className="break-words">
                <span className={`font-semibold ${m.fromId === meId ? 'text-white/60' : 'text-violet-300'}`}>
                  {m.fromId === meId ? 'Tú' : m.name}
                </span>{' '}
                <span className="text-[10px] text-white/40">{formatTime(m.at)}</span>
                <br />
                {m.text}
              </li>
            ))}
          </ul>
        </div>

        {error && <p className="text-xs text-red-300">{error}</p>}

        <form onSubmit={submit} className="flex gap-1.5">
          {/* Sin autoFocus: el teclado solo sale al tocar la caja "Responder…" */}
          <input
            className="min-w-0 flex-1 rounded-full bg-white/10 px-3 py-1.5 text-base transition outline-none placeholder:text-white/50 focus:bg-white/15 focus:ring-2 focus:ring-violet-400/50"
            value={text}
            maxLength={MAX_MESSAGE_LENGTH}
            placeholder="Responder…"
            enterKeyHint="send"
            onChange={(e) => setText(e.target.value)}
          />
          <button
            title="Enviar"
            aria-label="Enviar"
            className="grid size-9 shrink-0 place-items-center rounded-full bg-violet-600 transition hover:bg-violet-500 active:scale-90"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="size-4 translate-x-px" aria-hidden>
              <path d="M3.4 20.4 21 12 3.4 3.6l-.01 6.53L15 12 3.39 13.87z" />
            </svg>
          </button>
        </form>
      </div>
    </>
  );
}
