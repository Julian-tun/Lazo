// Dibujos del modo fiesta, hechos a mano en SVG (sin imágenes externas).

/** Gatita kawaii blanca con moño rosa. Puede sostener un lápiz o un corazón. */
export function Gatita({ con = 'corazon', className = '' }: { con?: 'lapiz' | 'corazon'; className?: string }) {
  const linea = '#4a1d33';
  return (
    <svg viewBox="0 0 120 132" className={className} aria-hidden>
      {/* Vestidito */}
      <path d="M36 94 Q60 84 84 94 L92 126 Q60 134 28 126 Z" fill="#f472b6" stroke={linea} strokeWidth="2.5" />
      <circle cx="48" cy="108" r="2.5" fill="#fff" />
      <circle cx="60" cy="114" r="2.5" fill="#fff" />
      <circle cx="72" cy="108" r="2.5" fill="#fff" />
      {/* Bracitos */}
      <ellipse cx="30" cy="100" rx="9" ry="7" fill="#fff" stroke={linea} strokeWidth="2.5" />
      <ellipse cx="90" cy="100" rx="9" ry="7" fill="#fff" stroke={linea} strokeWidth="2.5" />
      {/* Orejitas */}
      <path d="M22 44 L28 10 L52 30 Z" fill="#fff" stroke={linea} strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M29 34 L32 18 L44 29 Z" fill="#fbcfe8" />
      <path d="M98 44 L92 10 L68 30 Z" fill="#fff" stroke={linea} strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M91 34 L88 18 L76 29 Z" fill="#fbcfe8" />
      {/* Cabeza */}
      <ellipse cx="60" cy="60" rx="44" ry="35" fill="#fff" stroke={linea} strokeWidth="2.5" />
      {/* Moño */}
      <g transform="translate(88 24) rotate(18)">
        <ellipse cx="-10" cy="0" rx="12" ry="9" fill="#ec4899" stroke={linea} strokeWidth="2.5" />
        <ellipse cx="10" cy="0" rx="12" ry="9" fill="#ec4899" stroke={linea} strokeWidth="2.5" />
        <circle cx="0" cy="0" r="5.5" fill="#fde047" stroke={linea} strokeWidth="2.5" />
      </g>
      {/* Ojitos, naricita y cachetes */}
      <ellipse cx="42" cy="62" rx="4" ry="5.5" fill={linea} />
      <ellipse cx="78" cy="62" rx="4" ry="5.5" fill={linea} />
      <circle cx="43.5" cy="60" r="1.4" fill="#fff" />
      <circle cx="79.5" cy="60" r="1.4" fill="#fff" />
      <ellipse cx="60" cy="71" rx="5" ry="3.5" fill="#fde047" stroke={linea} strokeWidth="2" />
      <ellipse cx="32" cy="74" rx="6" ry="3.5" fill="#f9a8d4" opacity="0.8" />
      <ellipse cx="88" cy="74" rx="6" ry="3.5" fill="#f9a8d4" opacity="0.8" />
      {/* Bigotes */}
      <g stroke={linea} strokeWidth="2.2" strokeLinecap="round">
        <line x1="10" y1="62" x2="26" y2="66" />
        <line x1="8" y1="72" x2="25" y2="72" />
        <line x1="110" y1="62" x2="94" y2="66" />
        <line x1="112" y1="72" x2="95" y2="72" />
      </g>
      {/* Lo que sostiene */}
      {con === 'lapiz' ? (
        <g className="fiesta-pencil">
          <rect x="94" y="72" width="7" height="30" rx="2" fill="#fde047" stroke={linea} strokeWidth="2" transform="rotate(35 97 87)" />
          <path d="M104 106 l6 6 l-2 -9 z" fill={linea} transform="rotate(-10 106 108)" />
        </g>
      ) : (
        <path
          d="M90 112 C80 104 80 94 88 94 C92 94 94 98 94 100 C94 98 96 94 100 94 C108 94 108 104 98 112 L94 116 Z"
          fill="#f43f5e"
          stroke={linea}
          strokeWidth="2"
        />
      )}
    </svg>
  );
}

/** Rosa que se dibuja sola (contorno) y luego se colorea. */
export function Rosa({ className = '', delay = 0 }: { className?: string; delay?: number }) {
  const d = (s: number) => ({ animationDelay: `${delay + s}s` });
  return (
    <svg viewBox="0 0 100 130" className={className} aria-hidden>
      {/* Relleno (aparece después de dibujar) */}
      <g className="fiesta-rose-fill" style={d(2.4)}>
        <path d="M34 42 C30 22 58 12 72 26 C84 40 72 60 50 60 C38 60 32 52 34 42 Z" fill="#fb7185" />
        <path d="M51 88 C38 80 30 90 33 97 C42 98 48 94 51 88 Z" fill="#4ade80" />
        <path d="M52 102 C64 93 73 101 70 108 C62 110 56 106 52 102 Z" fill="#4ade80" />
      </g>
      {/* Contorno que se va dibujando */}
      <g fill="none" stroke="#be123c" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
        <path className="fiesta-rose-line" style={d(0)} d="M34 42 C30 22 58 12 72 26 C84 40 72 60 50 60 C38 60 32 52 34 42 Z" />
        <path className="fiesta-rose-line" style={d(0.6)} d="M50 44 C42 34 58 26 64 34 C70 42 58 50 50 46 C45 42 51 36 57 39" />
      </g>
      <g fill="none" stroke="#15803d" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
        <path className="fiesta-rose-line" style={d(1.1)} d="M52 60 C50 82 55 102 50 126" />
        <path className="fiesta-rose-line" style={d(1.6)} d="M51 88 C38 80 30 90 33 97 C42 98 48 94 51 88 Z" />
        <path className="fiesta-rose-line" style={d(1.9)} d="M52 102 C64 93 73 101 70 108 C62 110 56 106 52 102 Z" />
      </g>
    </svg>
  );
}

/** Corazón con un número adentro (la edad). */
export function CorazonEdad({ edad, className = '' }: { edad: number; className?: string }) {
  return (
    <svg viewBox="0 0 120 110" className={className} aria-hidden>
      <path
        d="M60 104 C20 76 4 54 10 32 C16 10 44 6 60 28 C76 6 104 10 110 32 C116 54 100 76 60 104 Z"
        fill="#ec4899"
        stroke="#9d174d"
        strokeWidth="3"
      />
      <ellipse cx="34" cy="34" rx="10" ry="6" fill="#fff" opacity="0.5" transform="rotate(-30 34 34)" />
      <text x="60" y="68" textAnchor="middle" fontFamily="Fredoka, sans-serif" fontWeight="700" fontSize="40" fill="#fff">
        {edad}
      </text>
    </svg>
  );
}
