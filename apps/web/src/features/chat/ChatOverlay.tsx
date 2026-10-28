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
            className="absolute bottom-3 left-3 z-10 grid size-10 place-items-center rounded-full bg-black/50 text-lg backdrop-blur-sm hover:bg-black/70"
          >
            💬
          </button>
        </>
      )}
    </div>
  );
}

/** Panel pequeño y transparente. La caja de texto va ARRIBA para que el teclado no la tape. */
function QuickChat({
  messages,
  meId,
  onSend,
  onClose,
}: Omit<Props, 'className'> & { onClose: () => void }) {
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
        className="absolute top-2 left-2 z-30 flex w-[45%] max-w-xs flex-col gap-2 rounded-2xl bg-black/45 p-2 text-white backdrop-blur-sm"
        style={{ bottom: 8 + keyboard }}
      >
        <button
          type="button"
          title="Cerrar chat"
          onClick={onClose}
          className="absolute top-1 right-1 z-10 rounded-lg px-2 py-0.5 text-white/70 hover:bg-white/10"
        >
          ✕
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
            className="min-w-0 flex-1 rounded-lg bg-white/10 px-2 py-1.5 text-base outline-none placeholder:text-white/50 focus:bg-white/15"
            value={text}
            maxLength={MAX_MESSAGE_LENGTH}
            placeholder="Responder…"
            enterKeyHint="send"
            onChange={(e) => setText(e.target.value)}
          />
          <button title="Enviar" className="rounded-lg bg-violet-600 px-2.5 text-sm font-semibold hover:bg-violet-500">
            ➤
          </button>
        </form>
      </div>
    </>
  );
}
