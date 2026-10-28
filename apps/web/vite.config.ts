import { networkInterfaces } from 'node:os';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

const PORT = 5173;
const SERVER_URL = 'http://localhost:3001';

/** Muestra en consola la(s) IP(s) locales para abrir la app desde el celular. */
function showLanUrl(): Plugin {
  return {
    name: 'lazo-lan-url',
    configureServer(server) {
      server.httpServer?.once('listening', () => {
        // Lista [nombre del adaptador, IP], con el Wi-Fi primero
        const ips = Object.entries(networkInterfaces())
          .flatMap(([iface, list]) =>
            (list ?? []).filter((n) => n.family === 'IPv4' && !n.internal).map((n) => [iface, n.address]),
          )
          .sort(([a], [b]) => Number(/wi-?fi|wlan/i.test(b)) - Number(/wi-?fi|wlan/i.test(a)));
        setTimeout(() => {
          console.log('\n  Abre desde el celular (mismo Wi-Fi) y acepta la advertencia del certificado:');
          for (const [iface, ip] of ips) console.log(`    https://${ip}:${PORT}   (${iface})`);
          console.log('  Usa la del adaptador Wi-Fi; las demás suelen ser virtuales.\n');
        }, 200);
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), basicSsl(), showLanUrl()],
  server: {
    host: true, // escucha en la red local (no solo localhost)
    port: PORT,
    strictPort: true,
    // Todo sale del mismo origen https://...:5173; Vite reenvía el tiempo real al servidor
    proxy: {
      '/socket.io': { target: SERVER_URL, ws: true },
    },
  },
});
