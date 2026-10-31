// Barra superior: código de sala, estado de conexión, quién está y botón salir.
import { useState, type ReactNode } from 'react';
import type { Participant } from '@lazo/shared';
import { Avatar } from '../../components/Avatar';
import { Logo } from '../../components/Logo';
import type { ConnectionState } from '../../lib/socket';

interface Props {
  code: string;
  participants: Participant[];
  meId: string;
  connection: ConnectionState;
  onLeave: () => void;
  className?: string;
  extra?: ReactNode; // botones extra a la izquierda de "Salir" (p. ej. ayuda)
}

export function RoomHeader({ code, participants, meId, connection, onLeave, className = '', extra }: Props) {
  const [copied, setCopied] = useState(false);
  const online = connection === 'connected';

  async function copyLink() {
    const link = `${location.origin}/sala/${code}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      prompt('Copia este enlace:', link);
    }
  }

  return (
    <header
      className={`relative z-10 flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-zinc-800/70 bg-zinc-950/60 px-3 py-2 backdrop-blur-md sm:px-4 ${className}`}
    >
      <Logo className="hidden size-7 sm:block" />

      {/* Código de la sala: al tocarlo se copia el enlace para invitar */}
      <button
        onClick={copyLink}
        title="Copiar enlace de invitación"
        className="group flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/80 py-1 pr-2 pl-2.5 font-mono text-sm tracking-widest transition hover:border-zinc-700 hover:bg-zinc-800 active:scale-95"
      >
        {code}
        {copied ? (
          <span className="animate-pop-in flex items-center gap-1 font-sans text-xs tracking-normal text-emerald-400">
            <svg viewBox="0 0 20 20" fill="currentColor" className="size-4" aria-hidden>
              <path d="M16.7 5.3a1 1 0 0 1 0 1.4l-8 8a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.4L8 12.6l7.3-7.3a1 1 0 0 1 1.4 0Z" />
            </svg>
            copiado
          </span>
        ) : (
          <svg
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.6}
            className="size-4 text-zinc-500 transition group-hover:text-zinc-300"
            aria-hidden
          >
            <rect x="7" y="7" width="10" height="10" rx="2" />
            <path d="M13 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2" />
          </svg>
        )}
      </button>

      {/* Estado de la conexión con el servidor */}
      <span
        className="flex items-center gap-1.5 text-xs text-zinc-400"
        title={online ? 'Conectado' : 'Reconectando…'}
      >
        <span className="relative flex size-2">
          {online && <span className="absolute inset-0 animate-ping rounded-full bg-emerald-400/60" />}
          <span
            className={`relative size-2 rounded-full ${online ? 'bg-emerald-400' : 'animate-pulse bg-amber-400'}`}
          />
        </span>
        <span className={online ? 'hidden sm:inline' : ''}>{online ? 'Conectado' : 'Reconectando…'}</span>
      </span>

      {/* Quién está en la sala */}
      <ul className="flex flex-1 flex-wrap gap-1.5 text-xs">
        {participants.map((p) => (
          <li
            key={p.id}
            className="animate-pop-in flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900/80 py-0.5 pr-2.5 pl-0.5"
            title={p.role === 'host' ? 'Anfitrión (comparte la pantalla)' : 'Espectador'}
          >
            <Avatar name={p.name} className="size-5 text-[10px]" />
            {p.role === 'host' && <span className="text-amber-400">★</span>}
            <span className="max-w-28 truncate">{p.name}</span>
            {p.id === meId && <span className="text-zinc-500">(tú)</span>}
          </li>
        ))}
      </ul>

      {extra}

      <button
        onClick={onLeave}
        className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-zinc-400 transition hover:bg-red-500/10 hover:text-red-300"
      >
        <svg
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.6}
          className="size-4"
          aria-hidden
        >
          <path
            d="M8 4H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h3M13 14l4-4-4-4M17 10H8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        Salir
      </button>
    </header>
  );
}
