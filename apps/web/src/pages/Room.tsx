// Pantalla de sala. Muestra un diseño distinto para anfitrión e invitado.
import { useEffect, useState, type FormEvent } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { MAX_NAME_LENGTH, type JoinedData } from '@lazo/shared';
import { ChatPanel } from '../features/chat/ChatPanel';
import { ChatOverlay } from '../features/chat/ChatOverlay';
import { FiestaGarland, FiestaOverlay } from '../features/fiesta/FiestaOverlay';
import { applyTheme, loadTheme, saveTheme } from '../features/fiesta/tema';
import { useFiesta } from '../features/fiesta/useFiesta';
import { RoomHeader } from '../features/room/RoomHeader';
import { useRoom } from '../features/room/useRoom';
import { Logo } from '../components/Logo';
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
  // Modo fiesta 🎂 (canción y felicitaciones): lo activa el anfitrión y lo guarda el servidor
  const fiesta = useFiesta(room.look?.party ?? false);

  // Tema de colores (normal o rosita). El del anfitrión manda y se recuerda en su navegador.
  const isHost = room.me?.role === 'host';
  const roomTheme = room.look?.theme;
  const { changeLook } = room;
  const [myTheme, setMyTheme] = useState(loadTheme);
  // Anfitrión: usa su tema guardado; si la sala tiene otro, se lo pasa a todos
  useEffect(() => {
    if (!isHost || !roomTheme) return;
    applyTheme(myTheme);
    if (roomTheme !== myTheme) void changeLook({ theme: myTheme });
  }, [isHost, myTheme, roomTheme, changeLook]);
  // Invitado: ve el tema de la sala y lo recuerda para la próxima vez
  useEffect(() => {
    if (isHost || !roomTheme) return;
    applyTheme(roomTheme);
    saveTheme(roomTheme);
  }, [isHost, roomTheme]);

  function leave() {
    room.leave();
    navigate('/', { replace: true });
  }

  // Entraron con el link directo (o la sala se perdió): pedir nombre
  if (!room.me) {
    if (room.autoJoining)
      return (
        <div className="animate-fade-in grid h-dvh place-items-center">
          <div className="flex flex-col items-center gap-4 text-sm text-zinc-400">
            <Spinner />
            Entrando a la sala…
          </div>
        </div>
      );
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
        <FiestaOverlay
          needsTap={fiesta.needsTap}
          onPlayMusic={fiesta.playMusic}
          onClose={fiesta.closeIntro}
        />
      )}
    </>
  );
  const errorBanner = room.error && (
    <p
      role="alert"
      className="animate-fade-in flex flex-wrap items-center gap-x-2 border-b border-red-500/20 bg-red-950/60 px-4 py-2 text-sm text-red-300"
    >
      {room.error}
      <button className="font-medium underline underline-offset-2 hover:text-red-200" onClick={leave}>
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
                theme={myTheme}
                onTheme={(t) => {
                  saveTheme(t);
                  setMyTheme(t);
                }}
                fiesta={fiesta.active}
                onFiesta={(on) => room.changeLook({ party: on })}
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
  // Celular horizontal: video a pantalla completa y chat encima del video (botón 💬).
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
            // Chat sobre el video (botón 💬): en pantalla completa y en celular horizontal
            overlay={(isFullscreen) => (
              <ChatOverlay
                messages={room.messages}
                meId={me.id}
                onSend={room.sendMessage}
                className={isFullscreen ? 'contents' : 'hidden phone-land:contents'}
              />
            )}
          />
        </section>

        {/* Chat de abajo (vertical) o a la derecha (PC). En horizontal se usa el 💬 sobre el video. */}
        <aside className="flex min-h-0 flex-1 flex-col border-t border-zinc-800 lg:w-96 lg:flex-none lg:border-t-0 lg:border-l phone-land:hidden">
          <ChatPanel className="flex-1" messages={room.messages} meId={me.id} onSend={room.sendMessage} />
        </aside>
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
    <main className="flex min-h-full items-center justify-center px-4 py-10">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <header className="animate-fade-up flex flex-col items-center gap-4 text-center">
          <Logo className="size-14 drop-shadow-xl" />
          <h1 className="text-2xl font-bold tracking-tight">
            Entrar a la sala
            <span className="mt-2 block font-mono text-xl tracking-[0.3em] text-violet-400">{code}</span>
          </h1>
        </header>
        <form
          onSubmit={submit}
          className="card animate-fade-up flex flex-col gap-3 p-5"
          style={{ animationDelay: '70ms' }}
        >
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
          {error && (
            <p
              role="alert"
              className="animate-scale-in rounded-xl border border-red-500/20 bg-red-950/50 px-3 py-2 text-sm text-red-300"
            >
              {error}
            </p>
          )}
        </form>
        <button
          className="animate-fade-in text-sm text-zinc-400 transition hover:text-zinc-200"
          style={{ animationDelay: '200ms' }}
          onClick={() => navigate('/')}
        >
          ← Volver al inicio
        </button>
      </div>
    </main>
  );
}

/** Ruedita de carga. */
function Spinner() {
  return (
    <span
      aria-hidden
      className="size-9 animate-spin rounded-full border-[3px] border-zinc-800 border-t-violet-500"
    />
  );
}
