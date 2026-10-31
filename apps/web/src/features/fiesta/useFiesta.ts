// Hook del modo fiesta: animación de felicitaciones y música.
// "active" viene de la sala (lo guarda el servidor), así no se apaga solo.
import { useCallback, useEffect, useRef, useState } from 'react';
import { MUSICA_URL } from './fiesta';

export function useFiesta(active: boolean) {
  const [showIntro, setShowIntro] = useState(false);
  // true si el navegador no dejó sonar la música solo y hay que tocar un botón
  const [needsTap, setNeedsTap] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const wasActive = useRef(false);

  // Al activarse (o al entrar a una sala que ya está de fiesta): mostrar la animación
  useEffect(() => {
    if (active && !wasActive.current) setShowIntro(true);
    if (!active) setShowIntro(false);
    wasActive.current = active;
  }, [active]);

  const playMusic = useCallback(async () => {
    try {
      // Solo si el archivo existe (si no lo pusieron, la fiesta sigue sin música)
      const res = await fetch(MUSICA_URL, { method: 'HEAD' });
      if (!res.ok || !res.headers.get('content-type')?.startsWith('audio')) return;
      if (!audioRef.current) audioRef.current = new Audio(MUSICA_URL);
      const audio = audioRef.current;
      audio.volume = 0.8;
      audio.currentTime = 0;
      await audio.play();
      setNeedsTap(false);
    } catch {
      // El navegador bloquea el sonido si no se tocó la pantalla antes: mostramos un botón
      setNeedsTap(true);
    }
  }, []);

  const stopMusic = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || audio.paused) return;
    // Bajar el volumen poco a poco antes de parar
    const fade = setInterval(() => {
      if (audio.volume > 0.08) audio.volume -= 0.08;
      else {
        clearInterval(fade);
        audio.pause();
      }
    }, 80);
  }, []);

  // La música suena mientras se ve la animación
  useEffect(() => {
    if (showIntro) void playMusic();
    else stopMusic();
  }, [showIntro, playMusic, stopMusic]);

  // Al salir de la sala, apagar la música
  useEffect(() => () => audioRef.current?.pause(), []);

  return {
    active,
    showIntro,
    needsTap,
    openIntro: () => setShowIntro(true),
    closeIntro: () => setShowIntro(false),
    playMusic,
  };
}
