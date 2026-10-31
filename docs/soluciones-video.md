SOLUCIONES PARA LA CALIDAD Y FLUIDEZ DEL VIDEO (Lazo)
==========================================================
Fecha: 26/10/2026
Estado: HECHO (30/10/2026). Se aplicaron el PASO 2 (mejoras rápidas) y el PASO 3 (SFU de
Cloudflare). Detalle y commits en SFU.txt (raíz del proyecto).


1. EL PROBLEMA
--------------
- Desde el panel del anfitrión se ve que los espectadores bajan a 7-10 fps y 180p.
- Al amigo de Argentina el panel le dice "⚠ limitado por la red".
- PERO incluso el celular del anfitrión, en el MISMO Wi-Fi que la compu, recibe
  180p y 7-10 fps, y ahí el panel NO dice "limitado por la red".
  => En casa no es el internet: el problema está en el ORIGEN (lo que Chrome
     captura de la pestaña ya sale pequeño y lento antes de enviarse).


2. LO QUE YA SE MIDIÓ
---------------------
- Compu del anfitrión: AMD Ryzen 7 7735H (8 núcleos), NVIDIA RTX 4060 Laptop
  + AMD Radeon integrada, 15 GB de RAM, Wi-Fi 6E. Plan de energía: "Equilibrado".
- Chrome 156. Codifica el video con el PROCESADOR (libvpx / VP8), una vez por
  cada espectador. No usa la tarjeta de video.
- Experimento (película simulada con mucho detalle, 3 espectadores, todo dentro
  de la compu): los 3 recibieron 1280x720 a 30 fps, sin límite, a 2.5 Mbps cada
  uno. Cada cuadro tardó unos 8 ms en codificarse (el límite para 30 fps es 33 ms).
  => El procesador y el código de la app alcanzan de sobra.
- Al amigo de Argentina la conexión directa le falló y entró por el TURN de
  Cloudflare (relay); a veces a 720p, a veces baja.


3. SOSPECHOSOS (de más a menos probable)
----------------------------------------
a) La pestaña de la película queda en segundo plano mientras el anfitrión mira
   la pestaña de Lazo, y Chrome le baja los fps y el tamaño a la captura.
b) Ahorro de energía de Chrome (chrome://settings/performance) o de la laptop
   con batería / plan "Equilibrado".
c) El reproductor de la página pone el video en baja resolución o en una "capa"
   que Chrome captura mal.
d) El ajuste automático de la captura de Chrome se queda atorado en bajo. El
   guardián actual SOLO actúa cuando dice "limitado por la red", así que en este
   caso no hace nada.
e) Para el amigo de Argentina además: su internet (¿datos o Wi-Fi?) y la
   distancia México-Argentina pasando por el TURN.


4. DATOS QUE FALTAN (pedírselos al usuario)
-------------------------------------------
[ ] Prueba 1: con el celular conectado, quedarse MIRANDO la pestaña de la
    película unos 20 s y luego ver en el panel si subió de 180p.
[ ] Prueba 2: laptop conectada a la corriente + desactivar "Ahorro de energía"
    en chrome://settings/performance + Windows en "Máximo rendimiento".
[ ] Archivo de diagnóstico: chrome://webrtc-internals -> "Create a
    WebRTC-Internals dump" -> "Download the webrtc-internals dump", guardado en
    E:\DevTools\duo-pruebas\. Ahí ver: media-source (tamaño y fps de la
    CAPTURA), outbound-rtp (frameHeight, framesPerSecond,
    qualityLimitationReason, targetBitrate), candidate-pair
    (availableOutgoingBitrate) y remote-inbound-rtp (fractionLost).
[ ] Velocidad de SUBIDA del anfitrión (fast.com -> "Mostrar más información").
[ ] chrome://gpu -> "Video Acceleration Information" -> qué dice en "Encode"
    (para saber si se puede usar la tarjeta de video).
[ ] Velocidad del internet del amigo (fast.com en su celular) y si usa datos
    o Wi-Fi.


5. PLAN DE SOLUCIONES
---------------------

PASO 1 - Hoy, sin cambiar la app (lo hace el usuario):
  - Quedarse en la pestaña de la película mientras se comparte.
  - Laptop conectada a la corriente.
  - Desactivar "Ahorro de energía" en chrome://settings/performance.
  - Windows en "Máximo rendimiento" (Configuración -> Sistema -> Energía).
  - En el reproductor, elegir la calidad más alta y dejar que cargue.
  - Si se puede, compu por cable al módem o cerca del módem.
  - El amigo: buen Wi-Fi (no datos), cerca del router, sin otras descargas.

PASO 2 - Mejoras rápidas en la app (SOLO la web, sin tocar el servidor):
  a) Modo "Película": degradationPreference "maintain-framerate" +
     contentHint "motion". Mantiene los 30 fps y, si falta red, baja un poco la
     nitidez en vez de entrecortarse.
  b) Guardián más listo: que también reinicie el ajuste cuando se quede en
     baja resolución SIN razón (qualityLimitationReason "none"), no solo con
     "bandwidth". Hoy está en HostPanel.tsx (refreshAdaptation en
     apps/web/src/lib/webrtc.ts).
  c) Usar la tarjeta de video (H.264) con setCodecPreferences, SOLO si
     chrome://gpu dice que hay codificación por hardware. Los celulares lo
     decodifican con hardware. Ojo: para la misma red, H.264 se ve un poco
     menos nítido que VP8/VP9.
  d) Arrancar con buena calidad (truco de Chrome x-google-start-bitrate en el
     SDP). No es oficial: probarlo con cuidado.

PASO 3 - El cambio grande: SFU de Cloudflare (Realtime SFU)  <- lo mejor para el amigo
  - La compu sube el video UNA sola vez a Cloudflare y Cloudflare lo reparte a
    cada espectador desde un servidor cercano a él (hay en Argentina).
  - Simulcast: la compu manda 3 calidades (alta / media / baja) y cada
    espectador recibe la mejor que aguante su internet, sin congelarse.
  - La subida del anfitrión ya no se multiplica por el número de espectadores.
  - Precio: gratis hasta 1000 GB al mes (compartidos con el TURN; el TURN es
    gratis cuando se usa junto con el SFU). Una película de 2 horas con 3
    espectadores son unos 7 GB.
  - Se usa la misma cuenta de Cloudflare.
  - Contras: SÍ toca el servidor (crear sesiones con la clave de Cloudflare).
    Es aproximadamente un día de trabajo más pruebas.

OTRA IDEA - "Modo sincronizado" (para YouTube y similares):
  - Cada quien reproduce el video en su propio dispositivo y la app solo
    sincroniza play / pausa / minuto. Calidad perfecta y casi sin usar internet
    del anfitrión.
  - Solo sirve con videos que cada uno pueda abrir por su cuenta (YouTube, o
    Netflix con cuenta propia). No sirve para páginas cualquiera.


6. RECOMENDACIÓN / ORDEN
------------------------
  1) Usuario: hacer el PASO 1 y conseguir los datos de la sección 4
     (sobre todo el archivo de diagnóstico).
  2) Con los datos, hacer el PASO 2 (seguro, solo web).
  3) Si el amigo de Argentina aún lo ve mal por su internet -> PASO 3 (SFU).
  REGLAS: no romper nada, probar todo (celular vertical y horizontal primero,
  porque Fiamma lo ve desde el celular), no tocar el servidor sin permiso,
  todo en español.


7. FUENTES
----------
  - Precios Cloudflare Realtime SFU/TURN:
    https://developers.cloudflare.com/realtime/sfu/platform/pricing/index.md
  - Cloudflare TURN / SFU: https://www.cloudflare.com/products/turn-sfu/
  - FAQ TURN: https://developers.cloudflare.com/realtime/turn/faq/index.md
  - Qué es un SFU: https://bloggeek.me/webrtcglossary/sfu/
  - Topologías WebRTC: https://antmedia.io/webrtc-network-topology/
  - degradationPreference (W3C):
    https://lists.w3.org/Archives/Public/public-webrtc-logs/2024Nov/0035.html
  - Codecs WebRTC: https://getstream.io/resources/projects/webrtc/advanced/codecs
  - Captura de pestaña con resolución automática (Chromium):
    https://lists.w3.org/Archives/Public/public-media-capture/2015Dec/0035.html
  - Control de bitrate en Chrome (Flashphoner): https://docs.flashphoner.com/x/1wqN
