// Abre un túnel rápido de Cloudflare hacia el modo compartir (http://localhost:8080)
// y muestra el link público para mandárselo a los espectadores.
// Al cerrar (Ctrl + C) el link deja de funcionar.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

const TARGET = 'http://localhost:8080';

// cloudflared puede no estar en el PATH: primero lo buscamos en E:\DevTools (donde está en esta PC),
// luego donde lo deja winget y, si no está en ninguno, probamos con el PATH.
const installed = [
  'E:\\DevTools\\cloudflared\\cloudflared.exe',
  'C:\\Program Files (x86)\\cloudflared\\cloudflared.exe',
  'C:\\Program Files\\cloudflared\\cloudflared.exe',
].find((p) => existsSync(p));
const exe = installed ?? 'cloudflared';

const child = spawn(exe, ['tunnel', '--no-autoupdate', '--url', TARGET], {
  stdio: ['ignore', 'pipe', 'pipe'],
});

let shown = false;
const onOutput = (chunk) => {
  const text = chunk.toString();
  const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
  if (match && !shown) {
    shown = true;
    console.log('\n  ==========================================================');
    console.log('   Link público (ábrelo TÚ también y comparte desde ahí):');
    console.log(`   ${match[0]}`);
    console.log('  ==========================================================');
    console.log('   Crea la sala y copia el enlace de invitación (botón junto al código).');
    console.log('   Para cerrar el túnel: Ctrl + C\n');
  }
  // Mostramos solo errores reales de cloudflared, no todo su registro
  for (const line of text.split('\n')) if (/\bERR\b/.test(line)) console.error('  [túnel] ' + line.trim());
};
child.stdout.on('data', onOutput);
child.stderr.on('data', onOutput);

child.on('error', (err) => {
  if (err.code === 'ENOENT') {
    console.error('No se encontró cloudflared. Instálalo con: winget install Cloudflare.cloudflared');
  } else {
    console.error('Error al iniciar cloudflared:', err.message);
  }
  process.exit(1);
});
child.on('exit', (code) => process.exit(code ?? 0));

// Al cerrar con Ctrl + C, cerrar también el túnel
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill());
