# Checklist de pruebas manuales

Antes de empezar: `npm run dev` en `E:\Lazo` y deja la terminal abierta.

> Ya se verificó automáticamente (con Chrome controlado por un script) que el invitado que entra tarde recibe
> video y audio, que el chat funciona en los dos sentidos, la presencia, detener y reanudar, y los tres diseños
> (vertical, horizontal y PC). Lo que sigue hay que comprobarlo **a mano**, porque depende de tus
> dispositivos, tu red y de lo que se oye.

## 0. Preparación

- [ ] La consola muestra `Servidor escuchando en http://localhost:3001`.
- [ ] La consola muestra `SFU: configurado (Cloudflare)` (si pusiste las claves del SFU en `apps/server/.env`).
- [ ] La consola muestra `https://192.168.x.x:5173   (Wi-Fi…)`. Anota esa dirección.
- [ ] Si Windows pregunta por el firewall de Node.js: permitir en **redes privadas**.

## 1. Dos navegadores en la misma PC

Anfitrión: **Chrome**. Invitado: **Edge** (o una ventana de incógnito de Chrome).

- [ ] Abrir <https://localhost:5173> en Chrome y aceptar la advertencia del certificado.
- [ ] Escribir un nombre y pulsar **Crear sala**. Aparece un código de 8 caracteres arriba.
- [ ] Pegar un link (p. ej. un video de YouTube) y pulsar **Abrir en pestaña nueva**. Se abre en otra pestaña.
- [ ] Volver a Lazo y pulsar **Compartir pestaña**:
  - [ ] El selector ofrece pestañas y **no** muestra la propia pestaña de Lazo.
  - [ ] Elegir la pestaña del video y dejar marcado **"Compartir audio de la pestaña"**.
  - [ ] Aparece "● Compartiendo", la vista previa y el botón **Dejar de compartir**.
- [ ] En Edge: abrir <https://localhost:5173>, poner otro nombre y el código, y pulsar **Unirse**.
- [ ] Ambos ven a las dos personas en la barra superior (★ = anfitrión) y el indicador "Conectado".
- [ ] Entran hasta 3 espectadores (otras ventanas de incógnito o celulares). La 5ª persona ve "La sala está llena".

## 2. Video y audio

- [ ] El invitado ve la pestaña en vivo, sin estirarse ni cortarse (puede haber franjas negras).
- [ ] Al principio está **silenciado** y aparece el botón grande **Activar sonido**.
- [ ] Tras pulsarlo, **se oye el audio de la pestaña** en el invitado.
- [ ] En el anfitrión aparece cada espectador con su estado, p. ej. "Beto: viendo ✓".
- [ ] Pulsar **Dejar de compartir**: el invitado ve "Esperando a que el anfitrión comparta…".
- [ ] Usar el botón "Dejar de compartir" de la **barra de Chrome**: el estado del anfitrión pasa a "Detenido".
- [ ] Volver a compartir: el invitado vuelve a ver el video sin recargar.

## 2b. Calidad y SFU (Cloudflare)

- [ ] En el anfitrión: `Envío: vía Cloudflare (SFU)` y las capas `Alta 720p / Media 360p / Baja 180p`.
- [ ] `Captura:` muestra el tamaño de la pestaña y ~30 fps. Si avisa "Chrome captura pocos cuadros": dejar la
      pestaña compartida a la vista y la laptop conectada a la corriente.
- [ ] Por espectador: `viendo ✓ · Cloudflare · Alta 720p 30fps`.
- [ ] En el espectador, el botón ⚙ (arriba a la izquierda) muestra las opciones con `✓ Auto · Alta 720p`. Elegir **Baja**: se ve más borroso en
      ~1 s; elegir **Auto**: vuelve a Alta.
- [ ] Cambiar **Contenido** a "Página / texto" con una página con letras: se leen nítidas.
- [ ] Cambiar **Calidad** a "Alta (1080p)": el espectador recibe 1080p (si la red y la compu alcanzan).
- [ ] Con audio estéreo (p. ej. un video de prueba izquierda/derecha) con audífonos: se oye cada lado por separado.
- [ ] **Plan B:** quitar las claves del SFU del `.env` y reiniciar: el panel dice `directo a cada espectador
      (P2P)` y todo sigue funcionando.

## 3. Invitado que entra tarde

- [ ] El anfitrión ya está compartiendo y **después** entra el invitado: ve el stream sin hacer nada más.
- [ ] El invitado pulsa **Salir** y vuelve a entrar con el código: vuelve a ver el stream.
- [ ] El invitado recarga la página (F5): vuelve a entrar solo y ve el stream y el historial del chat.

## 4. Chat

- [ ] Mensaje del anfitrión al invitado: llega con nombre y hora.
- [ ] Mensaje del invitado al anfitrión: llega con nombre y hora.
- [ ] Enviar más de 5 mensajes en 5 segundos muestra "Vas muy rápido, espera un momento".
- [ ] El campo no deja escribir más de 500 caracteres.

## 5. Celular como invitado (mismo Wi-Fi)

Android (Chrome) y/o iPhone (Safari):

- [ ] Abrir `https://192.168.x.x:5173` y aceptar la advertencia ("Avanzado" → "Continuar" / "Visitar este sitio web").
- [ ] Unirse con el código.
- [ ] **Vertical:** video arriba en 16:9 y chat abajo; el teclado no tapa la caja de texto.
- [ ] **Activar sonido** funciona y se oye.
- [ ] **Horizontal:** el video ocupa toda la pantalla; el chat está oculto.
  - [ ] Hay un solo botón de chat: el 💬 abajo a la izquierda (ya no hay "‹ Chat" arriba a la derecha). Abre el chat sobre el video.
  - [ ] Con el chat cerrado, el botón muestra cuántos mensajes nuevos hay.
- [ ] El botón ⛶ (abajo a la derecha) pone el video en pantalla completa (en iPhone usa el reproductor del sistema).
- [ ] **Avisos de mensajes:** en pantalla completa (o en horizontal con el chat cerrado), un mensaje del
      anfitrión aparece pequeño sobre el video y a los ~7 s baja y desaparece. Los tuyos no salen como aviso.
- [ ] **Responder sin girar:** tocar un aviso (o el botón 💬) abre un mini chat transparente a la izquierda.
      El teclado NO sale solo: aparece al tocar la caja "Responder…" (abajo). Los mensajes más nuevos quedan abajo.
      Se puede enviar sin salir de pantalla completa; al salir el teclado, el panel se sube y la caja sigue visible.
      Tocar en cualquier parte fuera del mini chat lo cierra (también la ✕).
- [ ] Estando en pantalla completa, girar a vertical: se sale solo de pantalla completa y se ve el chat para contestar.
- [ ] Bloquear y desbloquear el celular: el indicador pasa por "Reconectando…" y vuelve a "Conectado".
- [ ] **Guía de botones:** la primera vez que el celular entra como espectador sale la guía (6 pasos: sonido,
      calidad, pantalla completa, chat, personas y "?"). Se ve completa en vertical y en horizontal; "Saltar" o "Empezar"
      la cierran y no vuelve a salir. El botón **?** de la barra la abre otra vez. El anfitrión nunca la ve.
- [ ] **Barra de arriba en celular:** cabe en una sola fila (código, punto verde, 👥, ?, salir). El botón 👥 muestra
      quién está; tocar fuera lo cierra.
- [ ] **Fiesta con ahorro de batería:** con "reducir animaciones" o el ahorro de batería encendido, las cintas de
      frases de arriba y abajo se siguen moviendo.
- [ ] **Diseño:** botones, animaciones y textos se ven bien en tema normal y en tema Fiamma 🌸; los botones
      sobre el video (⚙, 💬, pantalla completa) se tocan cómodos con el dedo.

## 6. Conexión

- [ ] Detener `npm run dev` con Ctrl+C: ambos ven "Reconectando…".
- [ ] Volver a arrancarlo: se reconectan, pero la sala ya no existe (está en memoria). Es lo esperado: crear otra.

## Si algo falla

- **El celular no abre la página:** que esté en el mismo Wi-Fi, usar la IP del adaptador Wi-Fi y revisar el
  firewall de Windows (Node.js en redes privadas).
- **El invitado no ve video pero el chat sí funciona:** con SFU, revisar que la consola diga `SFU: configurado`.
  Sin SFU, probablemente la red bloquea la conexión directa (falta TURN). Pulsar "Reintentar".
- **Se ve borroso:** mirar en el panel del anfitrión si la `Captura` ya sale chica (problema de captura), si una
  capa dice "limitado por tu subida" (internet del anfitrión) o si el espectador tiene "⚠ su internet pierde X %".
- **No se oye:** volver a compartir y marcar "Compartir audio de la pestaña"; en el invitado pulsar "Activar sonido".
- Abrir la consola del navegador (F12) y buscar mensajes `[host]` o `[guest]`.
