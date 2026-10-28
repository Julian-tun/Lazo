// Barra superior: código de sala, estado de conexión, quién está y botón salir.
import { useState } from 'react';
import type { Participant } from '@lazo/shared';
import type { ConnectionState } from '../../lib/socket';

interface Props {
  code: string;
  participants: Participant[];
  meId: string;
  connection: ConnectionState;
  onLeave: () => void;
  className?: string;
}

export function RoomHeader({ code, participants, meId, connection, onLeave, className = '' }: Props) {
  const [copied, setCopied] = useState(false);

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
    <header className={`flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-zinc-800 px-4 py-2 ${className}`}>
      <button
        onClick={copyLink}
        title="Copiar enlace de invitación"
        className="rounded-lg bg-zinc-900 px-2 py-1 font-mono text-sm tracking-widest hover:bg-zinc-800"
      >
        {code} <span className="text-xs text-zinc-400">{copied ? '✓ copiado' : '⧉'}</span>
      </button>

      <span className="flex items-center gap-1.5 text-xs">
        <span
          className={`size-2 rounded-full ${connection === 'connected' ? 'bg-emerald-400' : 'animate-pulse bg-amber-400'}`}
        />
        {connection === 'connected' ? 'Conectado' : 'Reconectando…'}
      </span>

      <ul className="flex flex-1 flex-wrap gap-1.5 text-xs">
        {participants.map((p) => (
          <li key={p.id} className="rounded-full bg-zinc-800 px-2 py-0.5">
            {p.role === 'host' ? '★ ' : ''}
            {p.name}
            {p.id === meId && <span className="text-zinc-400"> (tú)</span>}
          </li>
        ))}
      </ul>

      <button onClick={onLeave} className="text-xs text-zinc-400 hover:text-red-300">
        Salir
      </button>
    </header>
  );
}
