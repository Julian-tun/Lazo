// Tema de colores de la app: "normal" (oscuro) o "fiamma" (rosita 🌸).
// Se recuerda en este navegador, así se queda igual para siempre hasta que lo cambies.
import type { RoomTheme } from '@lazo/shared';
import './tema.css';

const THEME_KEY = 'duo:tema';

export function loadTheme(): RoomTheme {
  try {
    return localStorage.getItem(THEME_KEY) === 'fiamma' ? 'fiamma' : 'normal';
  } catch {
    return 'normal'; // modo privado o almacenamiento bloqueado
  }
}

export function saveTheme(theme: RoomTheme) {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // sin almacenamiento: el tema solo dura mientras la página esté abierta
  }
}

/** Pinta toda la app con el tema: una clase en <html> cambia los colores (ver tema.css). */
export function applyTheme(theme: RoomTheme) {
  document.documentElement.classList.toggle('tema-fiamma', theme === 'fiamma');
  // Color de la barra del navegador en el celular
  const meta = document.querySelector('meta[name="theme-color"]');
  meta?.setAttribute('content', theme === 'fiamma' ? '#ffd6e8' : '#09090b');
}
