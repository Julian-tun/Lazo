// Mini tutorial del espectador: explica cada botón en pocos pasos. Sale solo la primera vez que
// alguien entra como espectador (se recuerda en el navegador) y se puede volver a ver con "?".
import { useEffect, useState, type ReactNode } from 'react';
import { ChatIcon, ExpandIcon, GearIcon, HelpIcon, SpeakerIcon, UsersIcon } from '../../components/icons';

// Dónde está cada botón sobre el video (igual que en GuestViewer)
type Spot = 'sound' | 'gear' | 'expand' | 'chat' | 'people' | 'help';

const STEPS: { spot: Spot; title: string; text: string }[] = [
  {
    spot: 'sound',
    title: 'Activa el sonido',
    text: 'El video empieza en silencio. Toca «Activar sonido» para escucharlo :v',
  },
  {
    spot: 'gear',
    title: 'Elige la calidad',
    text: 'Con el engranaje eliges Alta, Media o Baja. En Auto se ajusta sola a tu internet para que no se trabe xd',
  },
  {
    spot: 'expand',
    title: 'Pantalla completa',
    text: 'Mira el video en grande. Con el celular de lado se ve todavía mejor xD',
  },
  {
    spot: 'chat',
    title: 'Chatea sin salir del video',
    text: 'En pantalla completa o con el celular de lado, toca el globito para escribir. Los mensajes nuevos aparecen sobre el video XD',
  },
  {
    spot: 'people',
    title: '¿Quién está en la sala?',
    text: 'En el celular, toca el botón de personas de arriba para ver quién más está mirando :v',
  },
  {
    spot: 'help',
    title: '¡Listo!',
    text: 'Si se te olvida algo, vuelve a ver esta guía con el botón ? de arriba xd',
  },
];

interface Props {
  onClose: () => void;
}

export function Tutorial({ onClose }: Props) {
  const [step, setStep] = useState(0);
  const last = step === STEPS.length - 1;
  const s = STEPS[step];

  // Teclado (PC): flechas para moverse y Esc para cerrar
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') setStep((v) => Math.min(v + 1, STEPS.length - 1));
      if (e.key === 'ArrowLeft') setStep((v) => Math.max(v - 1, 0));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Guía de botones"
      className="animate-fade-in fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/60 p-4 phone-land:p-3 backdrop-blur-sm"
    >
      <div className="card animate-pop-in w-full max-w-sm overflow-hidden phone-land:flex phone-land:max-w-2xl phone-land:items-center bg-zinc-900/95 shadow-2xl">
        {/* Dibujo: un video de ejemplo con el botón de este paso resaltado */}
        <div className="phone-land:w-1/2 phone-land:shrink-0">
          <MiniVideo spot={s.spot} />
        </div>

        {/* Texto y botones (con el celular de lado van a la derecha del dibujo) */}
        <div className="phone-land:min-w-0 phone-land:flex-1">
          <div key={step} className="animate-fade-up flex flex-col gap-2 px-5 pt-4">
            <p className="text-xs font-medium text-violet-400">
              Paso {step + 1} de {STEPS.length}
            </p>
            <h2 className="text-lg font-semibold tracking-tight">{s.title}</h2>
            <p className="min-h-15 text-sm leading-relaxed text-zinc-400">{s.text}</p>
          </div>

          <div className="flex items-center justify-between gap-3 px-5 pt-3 pb-5">
            {/* Puntitos: en qué paso vas (se pueden tocar) */}
            <div className="flex gap-1.5">
              {STEPS.map((_, i) => (
                <button
                  key={i}
                  aria-label={`Ir al paso ${i + 1}`}
                  onClick={() => setStep(i)}
                  className={`h-1.5 rounded-full transition-all duration-300 ${
                    i === step ? 'w-5 bg-violet-500' : 'w-1.5 bg-zinc-700 hover:bg-zinc-600'
                  }`}
                />
              ))}
            </div>
            <div className="flex items-center gap-1">
              {!last && (
                <button
                  onClick={onClose}
                  className="rounded-lg px-3 py-2 text-sm text-zinc-400 transition hover:text-zinc-200"
                >
                  Saltar
                </button>
              )}
              <button
                onClick={() => (last ? onClose() : setStep(step + 1))}
                className="btn-primary px-4 py-2 text-sm"
                autoFocus
              >
                {last ? 'Empezar' : 'Siguiente'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Video de ejemplo con los botones en su lugar real; el del paso actual late y brilla. */
function MiniVideo({ spot }: { spot: Spot }) {
  // Botón chiquito de vidrio; "on" = el que se está explicando
  const btn = (on: boolean, children: ReactNode, pos: string) => (
    <span
      className={`absolute grid size-8 place-items-center rounded-full text-white ring-1 transition-all duration-500 ${pos} ${
        on ? 'scale-110 bg-violet-500 ring-white/40' : 'bg-black/45 opacity-40 ring-white/10'
      }`}
    >
      {on && <span className="absolute inset-0 animate-ping rounded-full bg-violet-400/50" />}
      <span className="relative">{children}</span>
    </span>
  );

  return (
    <div className="relative">
      {/* Barra de arriba (para señalar el botón de personas y el de ayuda) */}
      <div className="flex h-7 items-center justify-end gap-2 border-b border-white/5 bg-black/40 px-3">
        <span
          className={`relative flex h-5 items-center gap-1 rounded-full px-1.5 text-[10px] transition-all duration-500 ${
            spot === 'people' ? 'scale-125 bg-violet-500 text-white' : 'text-white/30'
          }`}
        >
          {spot === 'people' && (
            <span className="absolute inset-0 animate-ping rounded-full bg-violet-400/50" />
          )}
          <UsersIcon className="relative size-3.5" />
          <span className="relative">3</span>
        </span>
        <span
          className={`relative grid size-5 place-items-center rounded-full transition-all duration-500 ${
            spot === 'help' ? 'scale-125 bg-violet-500 text-white' : 'text-white/30'
          }`}
        >
          {spot === 'help' && (
            <span className="absolute inset-0 animate-ping rounded-full bg-violet-400/50" />
          )}
          <HelpIcon className="relative size-4" />
        </span>
      </div>
      <div className="relative aspect-video overflow-hidden bg-linear-to-br from-indigo-950 via-zinc-900 to-violet-950">
        {/* "Película" de fondo: unas formas suaves que se mueven */}
        <div className="animate-float absolute top-1/4 left-1/4 size-24 rounded-full bg-violet-500/20 blur-2xl" />
        <div
          className="animate-float absolute right-1/5 bottom-1/5 size-20 rounded-full bg-sky-500/15 blur-2xl"
          style={{ animationDelay: '-3s' }}
        />
        {btn(spot === 'gear', <GearIcon className="size-4" />, 'top-2.5 left-2.5')}
        {btn(spot === 'chat', <ChatIcon className="size-4" />, 'bottom-2.5 left-2.5')}
        {btn(spot === 'expand', <ExpandIcon className="size-4" />, 'right-2.5 bottom-2.5')}
        <span
          className={`absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold text-white transition-all duration-500 ${
            spot === 'sound'
              ? 'scale-110 bg-violet-500 shadow-lg shadow-violet-500/40'
              : 'bg-violet-600/40 opacity-40'
          }`}
        >
          {spot === 'sound' && (
            <span className="absolute inset-0 animate-ping rounded-full bg-violet-400/40" />
          )}
          <SpeakerIcon className="relative size-4" />
          <span className="relative">Activar sonido</span>
        </span>
      </div>
    </div>
  );
}
