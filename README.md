# Lazo

App web privada para ver juntos una página web: **hasta 4 personas** (1 comparte desde la PC y hasta 3 espectadores, normalmente desde el celular).

- El **anfitrión** crea una sala, abre un link en otra pestaña y comparte **solo esa pestaña** (con su audio).
- Los **espectadores** (hasta 3) entran con el código de sala y ven la transmisión en vivo, con chat, desde el celular o la PC.
- El video va por el **SFU de Cloudflare** (el anfitrión lo sube una vez y Cloudflare lo reparte a cada
  espectador). Si el SFU no está configurado o falla, va **P2P por WebRTC** (directo entre navegadores).
  El servidor maneja salas, chat y señalización; nunca ve el video.
- No se descarga ni se procesa el contenido de la página: solo se transmite la pestaña que el anfitrión elige.

> Estado: **esqueleto para pruebas locales.** Sin cuentas, sin base de datos, sin hosting.

## Requisitos

- Node.js 20 o superior (probado con Node 22) y npm
- Chrome o Edge en la PC (para el anfitrión)
- Celular en el mismo Wi-Fi (opcional, para probar como invitado)

## Arrancar

```powershell
cd E:\Lazo
npm install        # solo la primera vez (y si mueves o renombras la carpeta)
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
| `npm run lint`      | Revisa el código con ESLint (errores y malas prácticas) |
| `npm run format`    | Acomoda el formato del código con Prettier           |

## Estructura

```
Lazo/  (carpeta E:\Lazo)
├─ package.json              workspaces y scripts generales
├─ apps/
│  ├─ server/                Node + Express + Socket.IO (ejecutado con tsx)
│  │  └─ src/
│  │     ├─ index.ts         arranque del servidor HTTP y Socket.IO
│  │     ├─ rooms.ts         salas en memoria (Map), máx. 4 personas
│  │     ├─ socket.ts        eventos: salas, chat, señalización WebRTC y SFU
│  │     ├─ sfu.ts           API del SFU de Cloudflare (sesiones, publicar, recibir, capas)
│  │     └─ turn.ts          credenciales temporales del TURN de Cloudflare
│  └─ web/                   Vite + React + TypeScript + Tailwind CSS v4
│     ├─ vite.config.ts      HTTPS local, --host, proxy de /socket.io
│     ├─ public/             archivos estáticos: iconos, manifest, fiesta/ (imágenes y sonido)
│     └─ src/
│        ├─ pages/           Home.tsx (crear/unirse), Room.tsx (la sala)
│        ├─ features/
│        │  ├─ chat/         ChatPanel, ChatOverlay, ChatToasts
│        │  ├─ fiesta/       tema Fiamma (rosita, se recuerda) y modo fiesta (canción y felicitaciones)
│        │  ├─ room/         useRoom (estado de sala), RoomHeader
│        │  ├─ share/        HostPanel (anfitrión: abrir link + compartir pestaña)
│        │  └─ viewer/       GuestViewer (invitado: ver el stream)
│        ├─ lib/
│        │  ├─ socket.ts     conexión única de Socket.IO + estado de conexión
│        │  ├─ webrtc.ts     RTCPeerConnection (P2P), STUN/TURN, calidad, audio estéreo
│        │  ├─ sfu.ts        publicar y recibir por el SFU (3 capas / simulcast)
│        │  └─ sfuQuality.ts calidad automática del espectador (elige la capa)
│        ├─ App.tsx, main.tsx, index.css
├─ packages/shared/          tipos de eventos y límites compartidos (server + web)
├─ scripts/tunnel.mjs        túnel para compartir la app fuera de tu Wi-Fi (npm run share)
└─ docs/
   ├─ pruebas.md             checklist de pruebas manuales
   └─ soluciones-video.md    diagnóstico y plan para mejorar la calidad del video
```

## Cómo funciona (resumen)

1. Home → `room:create` o `room:join` (con ack). El servidor responde con la sala, quién está y el historial del chat.
2. El invitado, cuando su visor está listo, envía `webrtc:request`.

**Con SFU (si está configurado):**

3. El anfitrión abre UNA `RTCPeerConnection` con Cloudflare y publica (`sfu:publish`): video en 3 capas
   (simulcast: alta, media y baja) y audio. Cuando conecta, avisa `sfu:live` y el servidor manda
   `sfu:published` a los invitados (y a quien entre tarde, como respuesta a `webrtc:request`).
4. Cada invitado abre su propia conexión con Cloudflare: `sfu:subscribe` (recibe la oferta del SFU) y
   `sfu:answer` (su respuesta). Con `sfu:layer` cambia de capa sin reconectar.
5. El servidor guarda qué sesión del SFU es de quién: nadie puede tocar la sesión de otro. El App Secret
   de Cloudflare nunca sale del servidor.

**Sin SFU, o si el SFU falla (plan B, P2P):**

3. El anfitrión crea una `RTCPeerConnection` **para cada invitado** y le envía `webrtc:offer` (con `to`).
   El invitado responde con `webrtc:answer`. Ambos intercambian candidatos `webrtc:ice`; el servidor solo los
   **reenvía**. Cada intento lleva un `callId` para ignorar mensajes de intentos anteriores.
4. Si el SFU se cae a mitad de la película, el anfitrión pasa solo a P2P con todos. Si solo le falla a un
   invitado, ese invitado pide `webrtc:request` con `p2p: true` y recibe directo; los demás siguen por el SFU.

Al dejar de compartir, el anfitrión envía `webrtc:stop` (el servidor cierra también lo del SFU).

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
- `@lazo/shared`: paquete local (workspace) con los tipos de eventos; no se descarga de internet.

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

**Anfitrión:**
- **Calidad** (tope): Ahorro (480p, 0.8 Mbps), Normal (720p, 2.5 Mbps) o Alta (1080p, 5 Mbps). Por defecto: Normal.
- **Contenido:** "Película / video" cuida la **fluidez** (30 fps; si falta red baja un poco la nitidez) y
  "Página / texto" cuida la **nitidez** (letras legibles; si falta red baja los fps). Se puede cambiar en vivo.
- El panel muestra la **captura** (lo que Chrome toma de la pestaña, p. ej. `1280x720 30fps`; si salen pocos
  cuadros, avisa), el **modo de envío** (Cloudflare o P2P) y, con SFU, las 3 capas y la velocidad de subida.
- Por espectador: con SFU, la capa que recibe (`Alta 720p 30fps`) y si su internet pierde datos; en P2P, la
  calidad que se le envía, la ruta (directo o TURN), el códec y si está limitada por la compu o la red.
- **Guardián automático:** Chrome empieza enviando el video pequeño y a veces se queda atascado ahí. Cada 4 s,
  si sobra red o si envía menos de la mitad de lo que captura sin ningún motivo, se reinicia el ajuste
  (como mucho una vez cada 15 s).

**Con SFU (Cloudflare):**
- El anfitrión sube el video **una sola vez** en 3 capas (VP8): Alta (tamaño completo), Media (mitad) y Baja
  (un cuarto). Su subida ya no se multiplica por el número de espectadores.
- Cada espectador mide cada 2 s cómo le llega el video (pérdidas, retraso, congelamientos) y **baja o sube de
  capa solo** (`Auto`). Si uno tiene mal internet, a los demás no les afecta. También puede fijar la calidad
  con el botón ⚙ (arriba a la izquierda del video; al tocarlo salen Auto / Alta / Media / Baja).

**En P2P:** cada espectador tiene su propia conexión y WebRTC ajusta la calidad solo para él. Se prefiere
**VP9** (más nítido con la misma red); si el navegador del espectador no lo tiene, se usa VP8.

**Audio:** Opus en **estéreo** a 128 kbps (por defecto Chrome manda mono a ~32 kbps).

## SFU de Cloudflare (recomendado)

Con el SFU el video va **desde un servidor de Cloudflare cercano a cada espectador** (también en
Sudamérica) en vez de directo desde tu PC: más fluido entre países y con una sola subida para todos.

1. En el panel de Cloudflare, **Realtime → SFU → Create application**. Te da un **App ID** y un **App Secret**.
2. Ponlos en `apps/server/.env` (copia `apps/server/.env.example` si aún no lo tienes):
   `CLOUDFLARE_SFU_APP_ID=...` y `CLOUDFLARE_SFU_APP_SECRET=...`
3. Reinicia `npm run dev`. La consola dirá `SFU: configurado (Cloudflare)`.

En el panel del anfitrión verás `Envío: vía Cloudflare (SFU)`. Sin las claves, o si Cloudflare falla, la
app usa conexión directa (P2P) como siempre: nunca se queda sin video.

- **Costo:** SFU y TURN comparten **1000 GB gratis al mes** (lo que Cloudflare envía); después, $0.05 USD por GB.
  Una película de 2 h con 2 espectadores en Normal son unos 4–5 GB. Conviene poner una alerta de uso en Cloudflare.
- El App Secret **nunca** llega al navegador ni se sube a git (`.env` está en `.gitignore`).

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
- **Subida del anfitrión:** con SFU sube una sola vez (unos 3.5 Mbps en Normal, 7 Mbps en Alta, por las 3
  capas). Sin SFU (P2P) envía una copia a cada espectador: con 3 espectadores necesita unos 6–8 Mbps de subida.
- **Calidad:** al principio puede verse borroso unos segundos mientras WebRTC calcula cuánta red hay.
- **Captura de la pestaña:** si la pestaña compartida queda en segundo plano o la laptop está en ahorro de
  energía, Chrome puede capturar pocos cuadros (el panel lo avisa). Mejor dejarla a la vista y conectada.
- **Certificado autofirmado:** hay que aceptar la advertencia en cada dispositivo.

## Siguientes pasos

1. **Túnel** (Cloudflare Tunnel) para que alguien de otra red pueda entrar sin hosting.
2. **Hosting:** servir la web compilada y el servidor Socket.IO bajo un dominio con HTTPS real.
3. **Chat flotante para el anfitrión:** el anfitrión está en la otra pestaña viendo el contenido. Opciones:
   Document Picture-in-Picture (Chrome) con el chat, o una extensión del navegador.
4. Reconexión más tolerante (mantener la sala unos segundos si el anfitrión se desconecta).

## Licencia

© 2026 Julian-tun. **Todos los derechos reservados.** El código es público solo como muestra de trabajo;
no se permite copiarlo, modificarlo ni usarlo sin permiso por escrito. Ver [LICENSE](LICENSE).
