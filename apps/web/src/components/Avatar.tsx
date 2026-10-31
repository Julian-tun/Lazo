// Círculo con la inicial de una persona. El color sale de su nombre: cada quien tiene siempre el
// mismo color, así se reconoce rápido quién escribe.
const COLORS = [
  'from-violet-500 to-fuchsia-600',
  'from-sky-500 to-indigo-600',
  'from-emerald-500 to-teal-600',
  'from-amber-500 to-orange-600',
  'from-rose-500 to-pink-600',
];

function colorFor(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
}

interface Props {
  name: string;
  className?: string; // tamaño y letra (por defecto pequeño)
}

export function Avatar({ name, className = 'size-6 text-[11px]' }: Props) {
  const initial = [...name.trim()][0]?.toUpperCase() ?? '?';
  return (
    <span
      aria-hidden
      className={`grid shrink-0 place-items-center rounded-full bg-linear-to-br font-semibold text-white ring-2 ring-zinc-950/40 ${colorFor(name)} ${className}`}
    >
      {initial}
    </span>
  );
}
