// Animación de bienvenida del modo fiesta: ¡Feliz cumpleaños! 🎂💖
import { useEffect, useMemo, useState } from 'react';
import '@fontsource/fredoka/latin-500.css';
import '@fontsource/fredoka/latin-700.css';
import '@fontsource/pacifico/latin-400.css';
import './fiesta.css';
import { CUMPLE_EDAD, CUMPLE_NOMBRE, FRASES_LINDAS, MENSAJES_AMOR, NOVIO_NOMBRE } from './fiesta';
import { CorazonEdad, Gatita, Rosa } from './Dibujos';

const COSITAS = ['💖', '💕', '🌸', '🌷', '🌹', '🎀', '✨', '🐱', '💗', '🌺', '🧁', '🎈'];

// Stickers de fiesta flotando alrededor (los "cel" también salen en el celular, en las esquinas)
const STICKERS = [
  { src: '/fiesta/cumpleanos.gif', pos: 'top-[6%] left-[3%] sm:left-[8%] phone-land:top-[13%] phone-land:left-[2%]', cel: true },
  { src: '/fiesta/globos.gif', pos: 'top-[6%] right-[3%] sm:right-[8%] phone-land:top-[13%] phone-land:right-[2%]', cel: true },
  { src: '/fiesta/rosquilla.png', pos: 'bottom-[6%] left-[3%] sm:bottom-[9%] sm:left-[10%] phone-land:bottom-[13%] phone-land:left-[2%]', cel: true },
  { src: '/fiesta/papel-picado.gif', pos: 'bottom-[6%] right-[3%] sm:bottom-[9%] sm:right-[10%] phone-land:bottom-[13%] phone-land:right-[2%]', cel: true },
  { src: '/fiesta/chica.gif', pos: 'top-[30%] left-[6%]', cel: false },
  { src: '/fiesta/cerdo.png', pos: 'top-[30%] right-[6%]', cel: false },
  { src: '/fiesta/fuegos-artificiales.gif', pos: 'top-[56%] left-[13%]', cel: false },
  { src: '/fiesta/gestion-de-eventos.png', pos: 'top-[56%] right-[13%]', cel: false },
];

// Fotitos que puso el anfitrión en apps/web/public/fiesta/
const FOTOS = [
  { src: '/fiesta/gato-gorrito.gif', alt: 'Gatito con gorrito de fiesta', giro: -6 },
  { src: '/fiesta/gato-vela.gif', alt: 'Gatito apagando la vela del pastel', giro: 3 },
  { src: '/fiesta/gato-pastel.jpg', alt: 'Gatito comiendo pastel rosa', giro: -2 },
];

interface Props {
  needsTap: boolean; // el navegador no dejó sonar la música solo
  onPlayMusic: () => void;
  onClose: () => void;
}

/** Cinta de mensajes de amor que pasa de un lado a otro sin parar. */
function CintaAmor({ reverse = false, className = '' }: { reverse?: boolean; className?: string }) {
  // La cinta de abajo va en otro orden para que no se vean iguales
  const mensajes = reverse ? [...MENSAJES_AMOR].reverse() : MENSAJES_AMOR;
  return (
    <div className={`fiesta-marquee ${className}`} aria-hidden>
      <div className={`fiesta-marquee-track ${reverse ? 'reverse' : ''}`}>
        {/* Dos copias seguidas: así la vuelta no se nota */}
        {[0, 1].map((copia) =>
          mensajes.map((m) => (
            <span key={`${copia}-${m}`} className="px-4">
              {m}
            </span>
          )),
        )}
      </div>
    </div>
  );
}

/** Frases lindas que van saliendo una tras otra en lugares al azar. */
function FrasesQueSalen() {
  const [burbujas, setBurbujas] = useState<{ id: number; texto: string; left: number; top: number }[]>([]);

  useEffect(() => {
    let siguiente = 0;
    const timers: number[] = [];
    const salir = () => {
      const id = siguiente;
      const texto = FRASES_LINDAS[siguiente % FRASES_LINDAS.length];
      siguiente++;
      // Lugar al azar, sin pegarse a las orillas ni a las cintas de arriba/abajo
      const burbuja = { id, texto, left: 18 + Math.random() * 64, top: 12 + Math.random() * 74 };
      setBurbujas((b) => [...b, burbuja]);
      // Se quita al terminar su animación (4.5 s)
      timers.push(window.setTimeout(() => setBurbujas((b) => b.filter((x) => x.id !== id)), 4600));
    };
    salir();
    const intervalo = window.setInterval(salir, 1500);
    return () => {
      clearInterval(intervalo);
      timers.forEach(clearTimeout);
    };
  }, []);

  return (
    <>
      {burbujas.map((b) => (
        <span
          key={b.id}
          className="fiesta-frase pointer-events-none absolute z-20 rounded-full bg-white/85 px-3 py-1.5 text-sm font-bold whitespace-nowrap text-pink-600 shadow-lg shadow-pink-300/60 sm:text-base"
          style={{ left: `${b.left}%`, top: `${b.top}%` }}
        >
          {b.texto}
        </span>
      ))}
    </>
  );
}

/** Texto cuyas letras rebotan una por una. */
function Rebote({ texto, desde = 0 }: { texto: string; desde?: number }) {
  return (
    <>
      {[...texto].map((letra, i) => (
        <span key={i} className="fiesta-letter" style={{ animationDelay: `${(desde + i) * 0.08}s` }}>
          {letra === ' ' ? ' ' : letra}
        </span>
      ))}
    </>
  );
}

export function FiestaOverlay({ needsTap, onPlayMusic, onClose }: Props) {
  // Posición, tamaño y velocidad al azar para cada cosita que cae (se calcula una sola vez)
  const lluvia = useMemo(
    () => [
      ...Array.from({ length: 34 }, (_, i) => ({
        emoji: COSITAS[i % COSITAS.length],
        img: null as string | null,
        soloVertical: i % 2 === 1,
        left: Math.random() * 100,
        size: 16 + Math.random() * 22,
        duration: 7 + Math.random() * 7,
        delay: -Math.random() * 12, // negativo: algunas ya van cayendo al abrir
      })),
      // Los stickers también caen (así en el celular se ven todos)
      ...STICKERS.map((s) => ({
        emoji: '',
        img: s.src,
        soloVertical: false,
        left: Math.random() * 92,
        size: 30 + Math.random() * 10,
        duration: 9 + Math.random() * 6,
        delay: -Math.random() * 14,
      })),
    ],
    [],
  );

  return (
    <div
      className="fiesta-overlay fixed inset-0 z-[100] overflow-x-hidden overflow-y-auto text-pink-700"
      role="dialog"
      aria-label={`Feliz cumpleaños ${CUMPLE_NOMBRE}`}
    >
      {/* Capa de atrás (no estira la página ni recibe toques): lluvia y stickers */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        {/* Lluvia de corazones, flores y gatitos */}
        {lluvia.map((c, i) => (
          <span
            key={i}
            className={`fiesta-fall ${c.soloVertical ? 'phone-land:hidden' : ''}`}
            style={{ left: `${c.left}%`, fontSize: c.size, animationDuration: `${c.duration}s`, animationDelay: `${c.delay}s` }}
          >
            {c.img ? (
              <img
                src={c.img}
                alt=""
                className="rounded-full bg-white object-contain p-0.5 shadow-md ring-2 ring-pink-200"
                style={{ width: c.size, height: c.size }}
              />
            ) : (
              c.emoji
            )}
          </span>
        ))}

        {/* Stickers redondos que se balancean */}
        {STICKERS.map((s, i) => (
          <img
            key={s.src}
            src={s.src}
            alt=""
            loading="lazy"
            className={`fiesta-cat pointer-events-none absolute ${s.pos} ${s.cel ? 'block' : 'hidden lg:block'} size-12 rounded-full bg-white object-contain p-1 shadow-lg shadow-pink-300/70 ring-4 ring-pink-200 sm:size-20 phone-land:size-11 phone-land:ring-2`}
            style={{ animationDelay: `${i * -0.45}s` }}
          />
        ))}
      </div>

      {/* Capa de adelante: cintas de mensajes y frases (tampoco reciben toques) */}
      <div className="pointer-events-none fixed inset-0 z-10 overflow-hidden">
        {/* Cintas de mensajes de amor: arriba va hacia un lado y abajo hacia el otro */}
        <CintaAmor className="pointer-events-none absolute inset-x-0 top-0 z-10 bg-white/55 py-1.5 text-sm font-semibold text-pink-600 backdrop-blur-sm sm:text-base phone-land:py-1 phone-land:text-xs" />
        <CintaAmor
          reverse
          className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-white/55 py-1.5 text-sm font-semibold text-pink-600 backdrop-blur-sm sm:text-base phone-land:py-1 phone-land:text-xs"
        />

        {/* Frases lindas que van saliendo en burbujitas */}
        <FrasesQueSalen />

      </div>

      {/* Celular vertical / PC: todo en una columna.
          Celular horizontal: dos columnas (textos a la izquierda, dibujos y botón a la derecha). */}
      <div className="relative mx-auto flex min-h-full max-w-xl flex-col items-center justify-center gap-2 px-4 py-10 text-center phone-land:max-w-4xl phone-land:flex-row phone-land:gap-6 phone-land:py-9">
        {/* ---- Grupo 1: textos ---- */}
        <div className="flex flex-col items-center gap-2 phone-land:flex-1 phone-land:gap-1">
          <p className="text-xl tracking-[0.4em] phone-land:hidden">
            <span className="fiesta-twinkle inline-block">✨</span>
            <span className="fiesta-twinkle inline-block" style={{ animationDelay: '0.4s' }}>💖</span>
            <span className="fiesta-twinkle inline-block" style={{ animationDelay: '0.8s' }}>✨</span>
          </p>

          <h1
            className="font-bold leading-none text-pink-600 drop-shadow-[0_3px_0_#fff]"
            style={{ fontFamily: 'Fredoka, sans-serif', fontSize: 'clamp(1.5rem, min(8vw, 9vh), 3.2rem)' }}
          >
            <Rebote texto="¡FELIZ" />
            <br />
            <Rebote texto="CUMPLEAÑOS!" desde={6} />
          </h1>

          <CorazonEdad edad={CUMPLE_EDAD} className="fiesta-beat h-[clamp(3.5rem,min(18vw,9vh),7rem)] w-auto drop-shadow-lg phone-land:h-14" />

          {/* El nombre que se escribe solo, con corazoncitos alrededor */}
          <div className="relative w-full max-w-[min(24rem,40vh)] phone-land:max-w-[19rem]">
            <svg viewBox="0 0 320 110" className="w-full" aria-label={CUMPLE_NOMBRE}>
              <text x="160" y="78" textAnchor="middle" fontSize="72" className="fiesta-write">
                {CUMPLE_NOMBRE}
              </text>
            </svg>
            {['8%', '30%', '55%', '78%', '92%'].map((left, i) => (
              <span
                key={left}
                className="fiesta-pop absolute text-lg"
                style={{ left, top: i % 2 ? '8%' : '62%', animationDelay: `${4 + i * 0.35}s` }}
              >
                {i % 2 ? '💕' : '💗'}
              </span>
            ))}
          </div>

          {/* JULIAN & FIAMMA FOREVER, con brillito y corazones que laten */}
          <p className="flex items-center gap-2 font-bold tracking-wide" style={{ fontSize: 'clamp(0.95rem, min(4.6vw, 5vh), 1.7rem)' }}>
            <span className="fiesta-beat inline-block">💞</span>
            <span className="fiesta-shimmer">
              {NOVIO_NOMBRE.toUpperCase()} &amp; {CUMPLE_NOMBRE.toUpperCase()} FOREVER ∞
            </span>
            <span className="fiesta-beat inline-block [animation-delay:-0.5s]">💞</span>
          </p>
        </div>

        {/* ---- Grupo 2: dibujos, fotos y botón ---- */}
        <div className="flex flex-col items-center gap-2 phone-land:flex-1 phone-land:gap-1">
          {/* Gatitas: una dibuja una rosa, la otra trae un corazón */}
          <div className="flex items-end justify-center gap-1">
            <Gatita con="lapiz" className="fiesta-cat h-[clamp(4.5rem,min(24vw,12vh),8.5rem)] w-auto phone-land:h-20" />
            <Rosa className="h-[clamp(4rem,min(22vw,11vh),8rem)] w-auto phone-land:h-[4.5rem]" delay={0.5} />
            <Rosa className="h-[clamp(3rem,min(17vw,8.5vh),6.5rem)] w-auto phone-land:h-14" delay={2.2} />
            {/* la segunda gatita se balancea a otro ritmo */}
            <Gatita con="corazon" className="fiesta-cat h-[clamp(4.5rem,min(24vw,12vh),8.5rem)] w-auto [animation-delay:-1.1s] phone-land:h-20" />
          </div>

          {/* Fotitos de gatitos de cumpleaños, tipo polaroid */}
          <div className="flex items-start justify-center gap-2 py-1">
            {FOTOS.map((f, i) => (
              <figure
                key={f.src}
                className="fiesta-cat rounded-md bg-white p-1.5 pb-5 shadow-lg shadow-pink-300/60"
                style={{ rotate: `${f.giro}deg`, animationDelay: `${i * -0.7}s` }}
              >
                <img
                  src={f.src}
                  alt={f.alt}
                  className="h-[clamp(4rem,min(22vw,10vh),7.5rem)] w-[clamp(4rem,min(22vw,10vh),7.5rem)] rounded-sm object-cover phone-land:h-16 phone-land:w-16"
                />
              </figure>
            ))}
          </div>

          <p className="text-sm font-medium text-pink-700/80">🌸 Con mucho amor 🌸</p>

          <div className="mt-2 flex flex-wrap items-center justify-center gap-2 phone-land:mt-1">
            {needsTap && (
              <button
                onClick={onPlayMusic}
                className="rounded-full bg-white/80 px-5 py-3 font-semibold text-pink-600 shadow-md hover:bg-white phone-land:py-2"
              >
                🎵 Tocar Las Mañanitas
              </button>
            )}
            <button
              onClick={onClose}
              className="rounded-full bg-pink-500 px-6 py-3 text-lg font-bold text-white shadow-lg shadow-pink-300 hover:bg-pink-600 phone-land:py-2 phone-land:text-base"
            >
              💖 ¡A la fiesta!
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Guirnalda de la barra superior cuando hay fiesta, con botón para volver a ver la animación. */
export function FiestaGarland({ onReplay }: { onReplay: () => void }) {
  return (
    <div className="fiesta-garland flex items-center gap-2 overflow-hidden border-b border-zinc-800 bg-pink-100/70 py-1 pr-2 text-sm phone-land:hidden">
      {/* Mensajes de amor pasando de un lado a otro (no tapan el video: van en la barra) */}
      <CintaAmor className="min-w-0 flex-1 font-semibold text-pink-600" />
      <button
        onClick={onReplay}
        className="shrink-0 rounded-full bg-pink-500 px-3 py-0.5 text-xs font-bold whitespace-nowrap text-white hover:bg-pink-600"
      >
        🎂 <span className="hidden sm:inline">¡Feliz cumple {CUMPLE_NOMBRE}! · </span>ver de nuevo
      </button>
    </div>
  );
}
