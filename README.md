# DuoProject

App web privada para ver juntos una página web: **hasta 4 personas** (1 comparte desde la PC y hasta 3 espectadores, normalmente desde el celular).

- El **anfitrión** crea una sala, abre un link en otra pestaña y comparte **solo esa pestaña** (con su audio).
- Los **espectadores** (hasta 3) entran con el código de sala y ve la transmisión en vivo, con chat, desde el celular o la PC.
- El video va **P2P por WebRTC** (directo entre los dos navegadores). El servidor solo maneja salas, chat y señalización.
- No se descarga ni se procesa el contenido de la página: solo se transmite la pestaña que el anfitrión elige.

> Estado: **esqueleto para pruebas locales.** Sin cuentas, sin base de datos, sin hosting.

## Requisitos

- Node.js 20 o superior (probado con Node 22) y npm
- Chrome o Edge en la PC (para el anfitrión)
- Celular en el mismo Wi-Fi (opcional, para probar como invitado)

## Arrancar

```powershell
cd E:\DuoProject
npm install        # solo la primera vez
npm run dev        # levanta servidor + web a la vez
```

Luego abre:

- En la PC: <https://localhost:5173>
- En el celular: la dirección `https://192.168.x.x:5173` que aparece en la consola junto al adaptador **Wi-Fi**.

El certificado HTTPS es local y autofirmado, así que el navegador mostrará una advertencia: pulsa
"Configuración avanzada" → "Continuar". HTTPS es obligatorio porque los navegadores solo permiten
compartir pantalla y WebRTC en sitios seguros.

La primera vez, Windows puede preguntar si permite a Node.js usar la red: marca **Redes privadas** y acepta.
Si no, el celular no podrá conectarse.

Para detenerlo: `Ctrl + C` en la terminal.

## Scripts

| Comando             | Qué hace                                             |
| ------------------- | ---------------------------------------------------- |
| `npm run dev`       | Servidor (puerto 3001) + web (puerto 5173) a la vez  |
| `npm run typecheck` | Revisa los tipos de TypeScript en server y web       |
| `npm run build`     | Genera la web de producción en `apps/web/dist`       |

## Estructura

```
DuoProject/
├─ package.json              workspaces y scripts generales
├─ apps/
│  ├─ server/                Node + Express + Socket.IO (ejecutado con tsx)
│  │  └─ src/
│  │     ├─ index.ts         arranque del servidor HTTP y Socket.IO
│  │     ├─ rooms.ts         salas en memoria (Map), máx. 4 personas
│  │     └─ socket.ts        eventos: salas, chat, señalización WebRTC
│  └─ web/                   Vite + React + TypeScript + Tailwind CSS v4
│     ├─ vite.config.ts      HTTPS local, --host, proxy de /socket.io
│     └─ src/
│        ├─ pages/           Home.tsx (crear/unirse), Room.tsx (la sala)
│        ├─ features/
│        │  ├─ chat/         ChatPanel
│        │  ├─ room/         useRoom (estado de sala), RoomHeader
│        │  ├─ share/        HostPanel (anfitrión: abrir link + compartir pestaña)
│        │  └─ viewer/       GuestViewer (invitado: ver el stream)
│        ├─ lib/
│        │  ├─ socket.ts     conexión única de Socket.IO + estado de conexión
│        │  └─ webrtc.ts     RTCPeerConnection, STUN y lugar para TURN
│        ├─ App.tsx, main.tsx, index.css
├─ packages/shared/          tipos de eventos y límites compartidos (server + web)
└─ docs/pruebas.md           checklist de pruebas manuales
```

## Cómo funciona (resumen)

1. Home → `room:create` o `room:join` (con ack). El servidor responde con la sala, quién está y el historial del chat.
2. El invitado, cuando su visor está listo, envía `webrtc:request`.
3. Si el anfitrión está compartiendo, crea una `RTCPeerConnection` **para ese invitado** (una por espectador) y le envía `webrtc:offer` (con `to`). El invitado responde con `webrtc:answer`.
   Ambos intercambian candidatos `webrtc:ice`. El servidor solo **reenvía** estos mensajes: del anfitrión a un invitado concreto, o de un invitado al anfitrión.
4. Cada intento de conexión lleva un `callId`, para ignorar mensajes de intentos anteriores.
5. Al dejar de compartir, el anfitrión envía `webrtc:stop`.

Eventos y tipos: [packages/shared/src/index.ts](packages/shared/src/index.ts).

## Dependencias y para qué sirve cada una

**Raíz**
- `concurrently` (dev): ejecuta servidor y web a la vez con `npm run dev`.

**Servidor (`apps/server`)**
- `express`: servidor HTTP (ruta `/health`).
- `socket.io`: comunicación en tiempo real (salas, chat, señalización).
- `tsx` (dev): ejecuta TypeScript directamente y reinicia al guardar.
- `typescript`, `@types/express`, `@types/node` (dev): tipos y revisión de código.

**Web (`apps/web`)**
- `react`, `react-dom`: interfaz.
- `react-router-dom`: rutas `/` y `/sala/:codigo`.
- `socket.io-client`: cliente de Socket.IO.
- `vite`, `@vitejs/plugin-react` (dev): servidor de desarrollo y build.
- `@vitejs/plugin-basic-ssl` (dev): HTTPS local para probar desde el celular.
- `tailwindcss`, `@tailwindcss/vite` (dev): estilos.
- `typescript`, `@types/react`, `@types/react-dom`, `@types/node` (dev): tipos.

**Compartido**
- `@duo/shared`: paquete local (workspace) con los tipos de eventos; no se descarga de internet.

## Compartir con alguien de otra red (túnel)

Para que alguien fuera de tu casa (otro país, datos móviles) pueda entrar:

```powershell
npm run share
```

1. Compila la web y la sirve en el puerto 8080 (modo compartir).
2. Abre un túnel rápido de Cloudflare y muestra un link tipo `https://algo-aleatorio.trycloudflare.com`.
3. **Abre tú también ese link** (no localhost), crea la sala y comparte el enlace de invitación.
4. Al terminar: `Ctrl + C`. El link deja de funcionar. Cada vez que lo enciendes sale un link nuevo.

Seguridad del modo compartir:
- Por el link **solo** se sirve la web compilada (`apps/web/dist`). El código fuente, el `.env` y el resto del
  proyecto no se pueden pedir (devuelven la página de la app).
- El servidor solo acepta conexiones de Socket.IO desde su propia página (se verifica el origen).
- El chat y los nombres pasan por Cloudflare (manejan el HTTPS del link); el video no (va directo o por TURN, cifrado).
- No uses `npm run dev` con el túnel: el modo desarrollo de Vite no está pensado para internet.

Requiere `cloudflared`. En esta PC está en `E:\DevTools\cloudflared\cloudflared.exe` (es un solo archivo);
el script también lo busca donde lo instala winget y en el PATH. Puede funcionar al mismo tiempo que `npm run dev`.

## Calidad del video

- Cada espectador tiene su propia conexión: WebRTC ajusta la calidad **solo para él** según su internet.
  Si uno tiene mala conexión, a los demás no les afecta.
- El anfitrión elige el **tope** con el selector "Calidad": Ahorro (480p, 0.8 Mbps), Normal (720p, 2.5 Mbps)
  o Alta (1080p, 5 Mbps). Por defecto: Normal.
- En el panel se ve, por espectador, la calidad real que recibe (p. ej. `720p 30fps 1.8 Mbps`) y, si está
  limitada, por qué: `⚠ limitado por tu compu` o `⚠ limitado por la red`.
- **Guardián automático:** Chrome empieza enviando el video muy pequeño (no sabe aún cuánta red hay) y a veces
  se queda atascado ahí. Cada 4 s, si un espectador está "limitado por la red" pero sobra red, se reinicia el
  ajuste (como mucho una vez cada 15 s). Si la red de verdad es mala, no hace nada.

## Respaldo TURN (opcional)

Entre redes distintas (otro país, datos móviles) la conexión directa de video a veces falla. Para eso existe
el respaldo **TURN**: un intermediario que **solo se usa si la conexión directa falla**.

1. Crea una cuenta gratis en Cloudflare y, en la sección **Realtime → TURN Server**, crea una "TURN key".
   Te da un **Key ID** y un **API Token**.
2. Copia `apps/server/.env.example` como `apps/server/.env` y pega ahí los dos valores.
3. Reinicia `npm run dev`. La consola dirá `Respaldo TURN: configurado (Cloudflare)`.

En el panel del anfitrión verás `Respaldo TURN: listo ✓` y, por cada espectador, si va `· directo` o
`· por TURN (respaldo)`.

- El archivo `.env` **no se sube a git**. El token nunca llega al navegador: el servidor genera credenciales
  temporales (24 h) y solo las da a quien está dentro de una sala.
- Si Cloudflare no responde, la app sigue funcionando solo con conexión directa.

## Problemas conocidos

- **Sin TURN configurado:** con solo STUN, algunas redes (datos móviles, Wi-Fi de empresas, ciertos routers) no
  logran la conexión directa y el video no llega. Ver la sección "Respaldo TURN".
- **Salas en memoria:** al reiniciar el servidor (o al guardar un archivo del server con `npm run dev`) se pierden
  todas las salas. Hay que crear una nueva.
- **Si el anfitrión recarga la página estando solo**, la sala se borra (quedó vacía). Si el invitado sigue dentro,
  el anfitrión vuelve a entrar y recupera su rol, pero tiene que volver a pulsar "Compartir pestaña".
- **Compartir solo funciona en PC** (Chrome/Edge). Los navegadores de celular no permiten `getDisplayMedia`.
- **Audio de pestaña:** solo Chrome y Edge lo capturan, y solo si se marca "Compartir audio de la pestaña".
  Firefox y Safari no comparten audio de pestaña.
- **iPhone y pantalla completa:** Safari en iPhone usa su propio reproductor a pantalla completa y no deja
  mostrar nada encima, así que ahí no salen los avisos de mensajes. En horizontal sin pantalla completa sí salen.
- **Subida del anfitrión:** el anfitrión envía una copia del video a cada espectador. Con 3 espectadores
  necesita unos 6–8 Mbps de **subida** para buena calidad; si no alcanza, WebRTC baja la calidad solo.
  Para más de 3 espectadores convendría un servidor intermedio (SFU) que reciba una copia y la reparta.
- **Calidad:** WebRTC ajusta la resolución según la red; al principio puede verse borroso y mejora en segundos.
- **Certificado autofirmado:** hay que aceptar la advertencia en cada dispositivo.

## Siguientes pasos

1. **Túnel** (Cloudflare Tunnel) para que alguien de otra red pueda entrar sin hosting.
2. **Hosting:** servir la web compilada y el servidor Socket.IO bajo un dominio con HTTPS real.
3. **Chat flotante para el anfitrión:** el anfitrión está en la otra pestaña viendo el contenido. Opciones:
   Document Picture-in-Picture (Chrome) con el chat, o una extensión del navegador.
4. Reconexión más tolerante (mantener la sala unos segundos si el anfitrión se desconecta).
5. Control de calidad (resolución/fps) y estadísticas de conexión.
