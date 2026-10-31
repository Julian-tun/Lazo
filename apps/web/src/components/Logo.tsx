// Logo de Lazo: dos anillos entrelazados (dos personas unidas), igual idea que el favicon.
// Usa los colores de acento de la app, así cambia solo con el tema Fiamma.
import { useId } from 'react';

interface Props {
  className?: string;
  withText?: boolean; // muestra "Lazo" al lado
}

export function Logo({ className = 'size-9', withText = false }: Props) {
  const id = useId(); // ids únicos para el degradado (puede haber varios logos en pantalla)
  return (
    <span className="inline-flex items-center gap-2.5">
      <svg viewBox="0 0 40 40" className={className} aria-hidden="true">
        <defs>
          <linearGradient id={`${id}-bg`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="var(--color-violet-500)" />
            <stop offset="1" stopColor="var(--color-violet-600)" />
          </linearGradient>
        </defs>
        <rect width="40" height="40" rx="11" fill={`url(#${id}-bg)`} />
        <rect width="40" height="40" rx="11" fill="none" stroke="white" strokeOpacity=".15" />
        {/* Se dibuja el anillo derecho, encima el izquierdo y otra vez un pedacito del derecho:
            así uno pasa por encima arriba y el otro abajo, como eslabones */}
        <circle cx="24.5" cy="20" r="7" fill="none" stroke="white" strokeOpacity=".7" strokeWidth="3" />
        <circle cx="15.5" cy="20" r="7" fill="none" stroke="white" strokeWidth="3" />
        <path
          d="M18.44 23.5A7 7 0 0 0 22.69 26.76"
          fill="none"
          // Mismo tono que el anillo derecho (blanco al 70 % sobre el fondo)
          style={{ stroke: 'color-mix(in oklab, white 70%, var(--color-violet-600))' }}
          strokeWidth="3"
          strokeLinecap="round"
        />
      </svg>
      {withText && <span className="text-lg font-semibold tracking-tight">Lazo</span>}
    </span>
  );
}
