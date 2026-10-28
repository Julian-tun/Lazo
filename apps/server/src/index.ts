// Punto de entrada del servidor: Express (HTTP) + Socket.IO (tiempo real).
//
// Dos modos:
//   - Desarrollo (npm run dev): solo chat/salas en el puerto 3001; la web la sirve Vite.
//   - Compartir (npm run share, con --web): además sirve la web COMPILADA (apps/web/dist)
//     en el puerto 8080. Es lo que se expone por el túnel: solo archivos finales,
//     nunca el código fuente ni el .env.
import { existsSync } from 'node:fs';
import { createServer, type IncomingMessage } from 'node:http';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '@duo/shared';
import { registerSocketHandlers } from './socket.js';
import { roomCount } from './rooms.js';
import { turnConfigured } from './turn.js';

// Carga apps/server/.env si existe (ahí van las claves, que nunca se suben a git)
try {
  process.loadEnvFile(new URL('../.env', import.meta.url));
} catch {
  // sin .env: se usan los valores por defecto
}

const SERVE_WEB = process.argv.includes('--web');
const PORT = Number(process.env.PORT) || (SERVE_WEB ? 8080 : 3001);
const WEB_DIST = fileURLToPath(new URL('../../web/dist', import.meta.url));

const app = express();
app.disable('x-powered-by'); // no anunciar qué servidor usamos

// Cabeceras básicas de seguridad para todas las respuestas
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY'); // nadie puede meter la app dentro de otra página
  next();
});

// Ruta simple para comprobar que el servidor está vivo
app.get('/health', (_req, res) => {
  res.json({ ok: true, rooms: roomCount() });
});

if (SERVE_WEB) {
  if (!existsSync(WEB_DIST)) {
    console.error('No existe apps/web/dist. Ejecuta primero: npm run build');
    process.exit(1);
  }
  // Solo los archivos compilados de la web (y nada más del proyecto)
  app.use(express.static(WEB_DIST, { index: 'index.html', dotfiles: 'deny' }));
  // Cualquier otra ruta (p. ej. /sala/ABCD1234) devuelve la app; React decide qué mostrar
  app.get('/{*ruta}', (_req, res) => res.sendFile('index.html', { root: WEB_DIST }));
}

const httpServer = createServer(app);

/**
 * Solo aceptamos conexiones de Socket.IO que vengan de NUESTRA página
 * (el origen del navegador coincide con el host al que se conecta).
 * Así otra web no puede usar nuestro servidor desde el navegador de alguien.
 */
function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true; // sin navegador (p. ej. pruebas): no hay página que suplantar
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  maxHttpBufferSize: 100_000, // 100 KB: suficiente para SDP/ICE y chat
  allowRequest: (req, callback) => callback(null, sameOrigin(req)),
});

registerSocketHandlers(io);

httpServer.listen(PORT, () => {
  console.log(`Servidor escuchando en http://localhost:${PORT}`);
  if (SERVE_WEB) console.log('Modo compartir: sirviendo la web compilada (apps/web/dist)');
  console.log(
    turnConfigured()
      ? 'Respaldo TURN: configurado (Cloudflare)'
      : 'Respaldo TURN: no configurado (solo conexión directa). Ver apps/server/.env.example',
  );
});
