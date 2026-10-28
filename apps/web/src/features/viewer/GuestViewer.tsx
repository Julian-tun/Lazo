// Visor del INVITADO: recibe por WebRTC la pestaña que comparte el anfitrión.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { socket } from '../../lib/socket';
import { createPeerLink, getIceConfig, type PeerLink } from '../../lib/webrtc';

interface Props {
  meId: string;
  hostId: string | null; // null si el anfitrión no está en la sala
  // Capa extra sobre el video (p. ej. avisos de chat). Recibe si estamos en pantalla completa.
  overlay?: (isFullscreen: boolean) => ReactNode;
}

type Status = 'waiting' | 'connecting' | 'live' | 'failed';

export function GuestViewer({ meId, hostId, overlay }: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const linkRef = useRef<PeerLink | null>(null);
  const [status, setStatus] = useState<Status>('waiting');
  // Arranca silenciado: los navegadores solo dejan reproducir solo si está en silencio
  const [muted, setMuted] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Saber si estamos en pantalla completa, y salir solos al girar a vertical
  // (así se ve el chat para contestar).
  useEffect(() => {
    const onFsChange = () => setIsFullscreen(document.fullscreenElement === boxRef.current);
    const portrait = window.matchMedia('(orientation: portrait)');
    const onRotate = () => {
      if (portrait.matches && document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    };
    document.addEventListener('fullscreenchange', onFsChange);
    portrait.addEventListener('change', onRotate);
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange);
      portrait.removeEventListener('change', onRotate);
    };
  }, []);

  const reset = () => {
    linkRef.current?.close();
    linkRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setStatus('waiting');
  };

  useEffect(() => {
    // Oferta más reciente: si llegan dos seguidas, gana la última
    let latestCallId: string | null = null;
    // Candidatos ICE que llegan mientras aún preparamos la conexión
    let earlyIce: { callId: string; candidate: RTCIceCandidateInit }[] = [];

    // El anfitrión nos manda una oferta: creamos la conexión y respondemos
    const onOffer = async ({ callId, sdp }: { callId: string; sdp: RTCSessionDescriptionInit }) => {
      latestCallId = callId;
      setStatus('connecting');
      const { iceServers } = await getIceConfig(); // STUN + TURN de respaldo (si hay)
      if (latestCallId !== callId) return; // mientras tanto llegó otra oferta

      linkRef.current?.close();
      const link = createPeerLink(callId, iceServers, (candidate) =>
        socket.emit('webrtc:ice', { callId, candidate }),
      );
      linkRef.current = link;
      for (const e of earlyIce) if (e.callId === callId) void link.addIce(e.candidate);
      earlyIce = [];

      link.pc.ontrack = (e) => {
        const video = videoRef.current;
        const [remote] = e.streams;
        if (video && remote && video.srcObject !== remote) {
          video.srcObject = remote;
          video.play().catch(() => {}); // si falla, el usuario puede tocar "Activar sonido"
        }
      };
      link.pc.onconnectionstatechange = () => {
        const st = link.pc.connectionState;
        if (st === 'connected') setStatus('live');
        else if (st === 'failed') setStatus('failed');
        else if (st === 'disconnected') setStatus('connecting');
      };

      try {
        await link.setRemote(sdp);
        const answer = await link.pc.createAnswer();
        await link.pc.setLocalDescription(answer);
        if (linkRef.current === link) socket.emit('webrtc:answer', { callId, sdp: answer });
      } catch (err) {
        console.error('[guest] error respondiendo la oferta', err);
        setStatus('failed');
      }
    };
    const onIce = ({ callId, candidate }: { callId: string; candidate: RTCIceCandidateInit }) => {
      const link = linkRef.current;
      if (link?.callId === callId) void link.addIce(candidate);
      else if (callId === latestCallId && earlyIce.length < 50) earlyIce.push({ callId, candidate });
    };
    const onStop = () => reset();

    socket.on('webrtc:offer', onOffer);
    socket.on('webrtc:ice', onIce);
    socket.on('webrtc:stop', onStop);

    // Ya estamos escuchando: le pedimos el video al anfitrión.
    // Así funciona aunque entremos tarde, cuando él ya está compartiendo.
    if (hostId) socket.emit('webrtc:request');

    return () => {
      socket.off('webrtc:offer', onOffer);
      socket.off('webrtc:ice', onIce);
      socket.off('webrtc:stop', onStop);
      reset();
    };
  }, [meId, hostId]);

  function unmute() {
    const video = videoRef.current;
    if (!video) return;
    video.muted = false;
    setMuted(false);
    video.play().catch(() => {});
  }

  function fullscreen() {
    const box = boxRef.current;
    const video = videoRef.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
    if (document.fullscreenElement) void document.exitFullscreen();
    else if (box?.requestFullscreen) void box.requestFullscreen();
    else video?.webkitEnterFullscreen?.(); // iPhone
  }

  return (
    <div ref={boxRef} className="relative size-full bg-black">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={muted}
        className="absolute inset-0 size-full object-contain"
      />

      {status !== 'live' && (
        <div className="absolute inset-0 grid place-items-center p-6 text-center">
          <div className="flex flex-col items-center gap-3 text-sm text-zinc-400">
            {status === 'waiting' &&
              (hostId
                ? 'Esperando a que el anfitrión comparta su pestaña…'
                : 'El anfitrión no está en la sala')}
            {status === 'connecting' && 'Conectando video…'}
            {status === 'failed' && (
              <>
                <span className="text-red-300">No se pudo conectar el video.</span>
                <button className="btn-secondary text-sm" onClick={() => socket.emit('webrtc:request')}>
                  Reintentar
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {status === 'live' && muted && (
        <button
          onClick={unmute}
          className="absolute inset-x-0 bottom-6 mx-auto w-fit rounded-full bg-violet-600 px-6 py-4 text-lg font-bold text-white shadow-xl shadow-black/50 hover:bg-violet-500"
        >
          🔊 Activar sonido
        </button>
      )}

      {overlay?.(isFullscreen)}

      {status === 'live' && (
        <button
          onClick={fullscreen}
          title="Pantalla completa"
          className="absolute top-2 left-2 rounded-lg bg-black/50 px-2 py-1 text-sm text-white/80 hover:bg-black/70"
        >
          ⛶
        </button>
      )}
    </div>
  );
}
