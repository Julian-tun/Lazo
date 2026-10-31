// Pantalla inicial: poner nombre y crear o unirse a una sala.
import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { MAX_NAME_LENGTH, ROOM_CODE_LENGTH } from '@lazo/shared';
import { Logo } from '../components/Logo';
import { ACK_TIMEOUT_MS, clearSession, loadName, saveName, saveSession, socket } from '../lib/socket';

export default function Home() {
  const navigate = useNavigate();
  const [name, setName] = useState(loadName);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Si volvemos al inicio, salimos de cualquier sala anterior
  useEffect(() => {
    socket.emit('room:leave');
    clearSession();
  }, []);

  const cleanName = name.trim();
  const nameOk = cleanName.length > 0 && cleanName.length <= MAX_NAME_LENGTH;

  async function create() {
    if (!nameOk) return setError('Escribe tu nombre');
    setBusy(true);
    setError(null);
    try {
      const r = await socket.timeout(ACK_TIMEOUT_MS).emitWithAck('room:create', { name: cleanName });
      if (!r.ok) return setError(r.error);
      saveName(cleanName);
      saveSession(r.data.code, cleanName);
      navigate(`/sala/${r.data.code}`, { state: r.data });
    } catch {
      setError('No hay conexión con el servidor');
    } finally {
      setBusy(false);
    }
  }

  async function join(e: FormEvent) {
    e.preventDefault();
    if (!nameOk) return setError('Escribe tu nombre');
    const c = code.trim().toUpperCase();
    if (c.length !== ROOM_CODE_LENGTH) return setError(`El código tiene ${ROOM_CODE_LENGTH} caracteres`);
    setBusy(true);
    setError(null);
    try {
      const r = await socket.timeout(ACK_TIMEOUT_MS).emitWithAck('room:join', { code: c, name: cleanName });
      if (!r.ok) return setError(r.error);
      saveName(cleanName);
      saveSession(r.data.code, cleanName);
      navigate(`/sala/${r.data.code}`, { state: r.data });
    } catch {
      setError('No hay conexión con el servidor');
    } finally {
      setBusy(false);
    }
  }

  // Retraso de la animación de entrada de cada bloque (aparecen uno tras otro)
  const delay = (i: number) => ({ animationDelay: `${i * 70}ms` });

  return (
    <main className="relative flex min-h-full items-center justify-center overflow-hidden px-4 py-10">
      {/* Luces de fondo que flotan despacio (solo adorno) */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="animate-float absolute top-[12%] left-1/2 size-72 -translate-x-[120%] rounded-full bg-violet-600/20 blur-3xl" />
        <div
          className="animate-float absolute bottom-[10%] left-1/2 size-80 translate-x-[10%] rounded-full bg-violet-500/15 blur-3xl"
          style={{ animationDelay: '-3s' }}
        />
      </div>

      <div className="flex w-full max-w-sm flex-col gap-7">
        <header className="animate-fade-up flex flex-col items-center gap-4 text-center" style={delay(0)}>
          <div className="relative">
            <div
              aria-hidden
              className="animate-glow absolute -inset-3 rounded-3xl bg-violet-500/30 blur-xl"
            />
            <Logo className="relative size-16 drop-shadow-xl" />
          </div>
          <div>
            <h1 className="bg-linear-to-b from-zinc-100 to-zinc-400 bg-clip-text text-4xl font-bold tracking-tight text-transparent">
              Lazo
            </h1>
            <p className="mt-2 text-sm text-zinc-400">Mira una página con alguien más, en vivo.</p>
          </div>
        </header>

        <section className="card animate-fade-up flex flex-col gap-5 p-5 sm:p-6" style={delay(1)}>
          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium text-zinc-300">Tu nombre</span>
            <input
              className="input"
              value={name}
              maxLength={MAX_NAME_LENGTH}
              autoComplete="nickname"
              placeholder="Ej. Ana"
              onChange={(e) => setName(e.target.value)}
            />
          </label>

          <button className="btn-primary" disabled={busy} onClick={create}>
            <svg viewBox="0 0 20 20" fill="currentColor" className="size-5" aria-hidden>
              <path d="M10 4a1 1 0 0 1 1 1v4h4a1 1 0 1 1 0 2h-4v4a1 1 0 1 1-2 0v-4H5a1 1 0 1 1 0-2h4V5a1 1 0 0 1 1-1Z" />
            </svg>
            Crear sala
          </button>

          <div className="flex items-center gap-3 text-xs text-zinc-500">
            <div className="h-px flex-1 bg-linear-to-r from-transparent to-zinc-800" />o únete con un código
            <div className="h-px flex-1 bg-linear-to-l from-transparent to-zinc-800" />
          </div>

          <form className="flex gap-2" onSubmit={join}>
            <input
              className="input min-w-0 flex-1 text-center font-mono tracking-[0.3em] uppercase"
              value={code}
              maxLength={ROOM_CODE_LENGTH}
              placeholder="CÓDIGO"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
            />
            <button className="btn-secondary" disabled={busy} type="submit">
              Unirse
              <svg viewBox="0 0 20 20" fill="currentColor" className="size-4" aria-hidden>
                <path d="M10.3 4.3a1 1 0 0 1 1.4 0l5 5a1 1 0 0 1 0 1.4l-5 5a1 1 0 0 1-1.4-1.4L13.6 11H4a1 1 0 1 1 0-2h9.6l-3.3-3.3a1 1 0 0 1 0-1.4Z" />
              </svg>
            </button>
          </form>

          {error && (
            <p
              role="alert"
              className="animate-scale-in rounded-xl border border-red-500/20 bg-red-950/50 px-3 py-2 text-sm text-red-300"
            >
              {error}
            </p>
          )}
        </section>
      </div>
    </main>
  );
}
