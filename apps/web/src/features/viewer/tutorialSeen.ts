// ¿Este navegador ya vio el mini tutorial del espectador? (ver Tutorial.tsx)
const SEEN_KEY = 'duo:tutorial';

export function tutorialSeen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === 'visto';
  } catch {
    return true; // sin almacenamiento: no lo mostramos cada vez
  }
}

export function markTutorialSeen() {
  try {
    localStorage.setItem(SEEN_KEY, 'visto');
  } catch {
    // modo privado: no pasa nada
  }
}
