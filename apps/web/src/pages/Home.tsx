// Pantalla inicial: poner nombre y crear o unirse a una sala.
import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { MAX_NAME_LENGTH, ROOM_CODE_LENGTH } from '@lazo/shared';
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

  return (
    <main className="mx-auto flex min-h-full max-w-md flex-col justify-center gap-8 px-4 py-10">
      <header className="text-center">
        <h1 className="text-3xl font-bold tracking-tight">
          La<span className="text-violet-400">zo</span>
        </h1>
        <p className="mt-2 text-sm text-zinc-400">Mira una página con alguien más, en vivo.</p>
      </header>

      <label className="flex flex-col gap-2">
        <span className="text-sm text-zinc-300">Tu nombre</span>
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
        Crear sala
      </button>

      <div className="flex items-center gap-3 text-xs text-zinc-500">
        <div className="h-px flex-1 bg-zinc-800" />o únete con un código
        <div className="h-px flex-1 bg-zinc-800" />
      </div>

      <form className="flex gap-2" onSubmit={join}>
        <input
          className="input flex-1 font-mono tracking-widest uppercase"
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
        </button>
      </form>

      {error && <p className="rounded-lg bg-red-950/60 px-3 py-2 text-sm text-red-300">{error}</p>}
    </main>
  );
}
