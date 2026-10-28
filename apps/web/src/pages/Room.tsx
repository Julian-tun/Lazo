// Pantalla de sala. Muestra un diseño distinto para anfitrión e invitado.
import { useEffect, useState, type FormEvent } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { MAX_NAME_LENGTH, type JoinedData } from '@lazo/shared';
import { ChatPanel } from '../features/chat/ChatPanel';
import { ChatOverlay } from '../features/chat/ChatOverlay';
import { FIESTA_OFF, FIESTA_ON } from '../features/fiesta/fiesta';
import { FiestaGarland, FiestaOverlay } from '../features/fiesta/FiestaOverlay';
import { useFiesta } from '../features/fiesta/useFiesta';
import { RoomHeader } from '../features/room/RoomHeader';
import { useRoom } from '../features/room/useRoom';
import { HostPanel } from '../features/share/HostPanel';
import { GuestViewer } from '../features/viewer/GuestViewer';
import { loadName, saveName, useConnectionState } from '../lib/socket';

export default function Room() {
  const code = (useParams().code ?? '').toUpperCase();
  const navigate = useNavigate();
  const state = useLocation().state as JoinedData | null;
  // Datos de la sala si venimos desde Home (crear / unirse)
  const initial = state?.code === code ? state : null;

  const room = useRoom(code, initial);
  const connection = useConnectionState();
  // Modo fiesta 🎂 (solo diseño): se activa con un mensaje especial del anfitrión en el chat
  const fiesta = useFiesta(room.messages, room.participants);
  const [chatOpen, setChatOpen] = useState(false); // solo se usa en celular horizontal
  const [seen, setSeen] = useState(0);

  // Mensajes sin leer mientras el chat flotante está cerrado
  useEffect(() => {
    if (chatOpen) setSeen(room.messages.length);
  }, [chatOpen, room.messages.length]);
  const unread = Math.max(0, room.messages.length - seen);

  function leave() {
    room.leave();
    navigate('/', { replace: true });
  }

  // Entraron con el link directo (o la sala se perdió): pedir nombre
  if (!room.me) {
    if (room.autoJoining) return <p className="grid h-dvh place-items-center text-zinc-400">Entrando a la sala…</p>;
    return <JoinForm code={code} error={room.error} onJoin={room.join} />;
  }

  const me = room.me;
  const host = room.participants.find((p) => p.role === 'host') ?? null;
  const guests = room.participants.filter((p) => p.role === 'guest');

  const header = (
    <RoomHeader
      code={code}
      participants={room.participants}
      meId={me.id}
      connection={connection}
      onLeave={leave}
      className={me.role === 'guest' ? 'phone-land:hidden' : ''}
    />
  );
  // Guirnalda bajo la barra + animación de cumpleaños (solo si hay fiesta)
  const fiestaLayer = (
    <>
      {fiesta.active && <FiestaGarland onReplay={fiesta.openIntro} />}
      {fiesta.showIntro && (
        <FiestaOverlay needsTap={fiesta.needsTap} onPlayMusic={fiesta.playMusic} onClose={fiesta.closeIntro} />
      )}
    </>
  );
  const errorBanner = room.error && (
    <p className="bg-red-950/70 px-4 py-2 text-sm text-red-300">
      {room.error}{' '}
      <button className="underline" onClick={leave}>
        Volver al inicio
      </button>
    </p>
  );

  // ---------- ANFITRIÓN: controles a la izquierda, chat a la derecha ----------
  if (me.role === 'host') {
    return (
      <div className="flex h-dvh flex-col">
        {header}
        {fiestaLayer}
        {errorBanner}
        {/* Ventana angosta: todo se desplaza y el chat tiene altura propia. PC: dos columnas. */}
        <main className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
          <section className="shrink-0 lg:flex-1 lg:overflow-y-auto">
            <div className="mx-auto max-w-3xl">
              <HostPanel
                guests={guests}
                fiesta={fiesta.active}
                onFiesta={(on) => room.sendMessage(on ? FIESTA_ON : FIESTA_OFF)}
              />
            </div>
          </section>
          <aside className="flex h-[70dvh] shrink-0 flex-col border-t border-zinc-800 lg:h-auto lg:w-96 lg:border-t-0 lg:border-l">
            <ChatPanel className="flex-1" messages={room.messages} meId={me.id} onSend={room.sendMessage} />
          </aside>
        </main>
      </div>
    );
  }

  // ---------- INVITADO ----------
  // Celular vertical: video arriba (16:9) y chat abajo.
  // Celular horizontal: video a pantalla completa y chat flotante con botón.
  // PC (lg): video grande y chat a la derecha.
  return (
    <div className="flex h-dvh flex-col">
      {header}
      {fiestaLayer}
      {errorBanner}
      <main className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <section className="aspect-video w-full shrink-0 bg-black lg:aspect-auto lg:min-w-0 lg:flex-1 phone-land:fixed phone-land:inset-0 phone-land:aspect-auto">
          <GuestViewer
            meId={me.id}
            hostId={host?.id ?? null}
            // Chat sobre el video: siempre en pantalla completa; en horizontal solo si el chat lateral está cerrado
            overlay={(isFullscreen) => (
              <ChatOverlay
                messages={room.messages}
                meId={me.id}
                onSend={room.sendMessage}
                className={isFullscreen ? 'contents' : `hidden ${chatOpen ? '' : 'phone-land:contents'}`}
              />
            )}
          />
        </section>

        <aside
          className={`flex min-h-0 flex-1 flex-col border-t border-zinc-800 lg:w-96 lg:flex-none lg:border-t-0 lg:border-l phone-land:fixed phone-land:top-0 phone-land:right-0 phone-land:bottom-0 phone-land:z-10 phone-land:w-72 phone-land:border-0 phone-land:bg-zinc-950/60 phone-land:backdrop-blur-sm ${
            chatOpen ? '' : 'phone-land:hidden'
          }`}
        >
          <ChatPanel className="flex-1" messages={room.messages} meId={me.id} onSend={room.sendMessage} />
        </aside>

        {/* Botón para mostrar/ocultar el chat (solo celular horizontal) */}
        <button
          onClick={() => setChatOpen((v) => !v)}
          className={`fixed top-2 z-20 hidden rounded-full bg-black/60 px-3 py-1.5 text-sm text-white phone-land:block ${
            chatOpen ? 'right-74' : 'right-2'
          }`}
        >
          {chatOpen ? 'Ocultar chat ›' : `‹ Chat${unread ? ` (${unread})` : ''}`}
        </button>
      </main>
    </div>
  );
}

/** Formulario para entrar a una sala desde un enlace directo. */
function JoinForm({
  code,
  error,
  onJoin,
}: {
  code: string;
  error: string | null;
  onJoin: (name: string) => Promise<boolean>;
}) {
  const navigate = useNavigate();
  const [name, setName] = useState(loadName);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    setBusy(true);
    if (await onJoin(n)) saveName(n);
    setBusy(false);
  }

  return (
    <main className="mx-auto flex min-h-full max-w-md flex-col justify-center gap-6 px-4 py-10">
      <h1 className="text-center text-2xl font-bold">
        Entrar a la sala <span className="font-mono tracking-widest text-violet-400">{code}</span>
      </h1>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <input
          className="input"
          value={name}
          maxLength={MAX_NAME_LENGTH}
          placeholder="Tu nombre"
          autoComplete="nickname"
          onChange={(e) => setName(e.target.value)}
        />
        <button className="btn-primary" disabled={busy || !name.trim()}>
          Entrar
        </button>
      </form>
      {error && <p className="rounded-lg bg-red-950/60 px-3 py-2 text-sm text-red-300">{error}</p>}
      <button className="text-sm text-zinc-400 hover:text-zinc-200" onClick={() => navigate('/')}>
        ← Volver al inicio
      </button>
    </main>
  );
}
