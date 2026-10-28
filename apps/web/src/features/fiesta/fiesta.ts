// Modo fiesta 🎂: solo diseño. Se activa con un mensaje especial del anfitrión en el chat
// (así llega en vivo a todos y también a quien entre después, sin tocar el servidor).
import type { ChatMessage } from '@duo/shared';

// Datos del cumpleaños
export const CUMPLE_NOMBRE = 'Fiamma';
export const CUMPLE_EDAD = 19;
export const NOVIO_NOMBRE = 'Julian';

// Frases que van saliendo en burbujitas por la pantalla 💬
export const FRASES_LINDAS = [
  'Tu voz es hermosa 🎶',
  'Eres increíble ✨',
  'alice12690 💖',
  'Me encantas alv 😍',
  'Te amo un chingo wey 💘',
  'Voy a llorar de amor 🥹',
  'Bebesota 💋',
  'Mamasota 🔥',
  'Te adoro muchowei 💕',
];

// Mensajes de amor que pasan de un lado a otro 💌
export const MENSAJES_AMOR = [
  'Te amo Fiamma 💖',
  'Feliz cumple, mi amor 🎂',
  'Eres mi persona favorita 🌸',
  'Julian ♥ Fiamma 💞',
  'Mi niña hermosa 🎀',
  'Gracias por existir ✨',
  'Te quiero hoy, mañana y siempre 💕',
  'Eres lo más bonito de mi vida 🌷',
  'Mi corazón es tuyo 💗',
  'Aunque estemos lejos, te siento cerca 💌',
  'Por muchísimos años más juntos 🥰',
  'Eres mi sol ☀️',
  'Te adoro con todo mi corazón 😻',
  'Contigo todo es mejor 🌹',
  '19 años de pura belleza 👑',
  'Forever & ever 💍',
];

// Mensajes que el anfitrión manda al chat al activar / desactivar
export const FIESTA_ON = '🎂 ¡Modo fiesta activado! 💖';
export const FIESTA_OFF = '🎈 Modo fiesta desactivado';

// Música opcional: si este archivo existe en apps/web/public/fiesta/, suena al activar
export const MUSICA_URL = '/fiesta/mananitas.mp3';

/**
 * ¿Está activo el modo fiesta? Mira el ÚLTIMO mensaje de fiesta que mandó el anfitrión.
 * Solo cuentan los mensajes con el nombre del anfitrión, para que nadie más lo active.
 */
export function isFiestaActive(messages: ChatMessage[], hostName: string | null): boolean {
  if (!hostName) return false;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.name !== hostName) continue;
    if (m.text === FIESTA_ON) return true;
    if (m.text === FIESTA_OFF) return false;
  }
  return false;
}
