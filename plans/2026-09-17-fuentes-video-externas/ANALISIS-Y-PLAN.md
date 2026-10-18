# Fuentes de video externas como contenido EN VIVO

**Fecha:** 2026-09-17  
**Estado:** spike de Fase 1 en curso (2026-10-07), ver «Segunda tanda de decisiones»  
**Decisiones confirmadas (2026-09-17):** proyección de pantalla completa, con audio integrado; soporte objetivo macOS, Windows y Linux; las resoluciones se negocian según la fuente; la arquitectura debe aceptar entradas locales y de red.  
**Contrato operativo confirmado:** NEGRO/LOGO mutean el audio, como los videos actuales; NDI es el primer adaptador de red posterior a UVC; Linux inicialmente significa Ubuntu LTS x64; la latencia end-to-end aceptable es hasta 1 segundo; la reproducción de audio usa la salida predeterminada del sistema.  
**Decisión técnica recomendada:** construir un subsistema de captura nativo único (“capture agent”) con adaptadores de entrada y entregarlo a Electron por WebRTC local. UVC directo en Chromium queda sólo como spike de referencia, no como arquitectura final.

## Resumen ejecutivo

Es factible integrar fuentes externas como otra fuente de proyección en vivo, incluida cámara/capturadora local, NDI, RTSP/SRT/RIST y, mediante adaptadores posteriores, hardware profesional. Una cámara conectada mediante una capturadora USB moderna (UVC) puede abrirse directo con `getUserMedia()`, pero esa vía por sí sola no cubre el conjunto de protocolos, el audio integrado ni la necesidad de un único propietario de la captura.

La aplicación ya tiene el punto de extensión adecuado: la ventana de control calcula un `ProjectionOutput` serializable y la ventana de proyección lo representa. La señal debe abrirse **en la ventana de proyección**, que es donde se verá y donde viven los píxeles finales. No se debe intentar mandar un `MediaStream` mediante IPC: no es un dato serializable ni una propiedad durable del estado.

La mayor complejidad no es dibujar un `<video>` sino hacer que el ciclo de vida sea confiable en una reunión: permisos, una fuente que se desconecta, cambio de resolución/codec, la cámara tomada por otra aplicación, sincronización A/V, reconexión de red y que NEGRO/LOGO no reinicien la captura. “Cualquier resolución” debe significar negociar y reportar el modo que el hardware realmente concede, no prometer que cada adaptador/proyector podrá mostrar cada formato.

## Qué se encontró en WorshipApp

| Pieza existente | Situación | Consecuencia para esta iniciativa |
| --- | --- | --- |
| Flujo de proyección | `projection.store.ts` calcula `ProjectionOutput`; `projection-sync.ts` lo envía por IPC | Una fuente externa puede convertirse en otra variante declarativa de `BaseContent`/`ProjectionOutput`. |
| Ventana de proyección | `ProjectionApp.tsx` recibe pushes y recupera un snapshot si se abre tarde | Debe reconectar un `MediaStream` WebRTC local al recuperar el snapshot; no abre directamente la entrada física. |
| Renderizado | `OutputView.tsx` ya mantiene el video de archivo debajo de NEGRO/LOGO mediante `videoUnderlay` | La captura debe seguir el mismo patrón: mantener el stream cuando hay overlay; apagarlo al cambiar realmente de fuente o cerrar proyección. |
| IPC y seguridad | Contrato tipado, preload mínimo y lista de `webContents` confiables | Hay un lugar claro para CRUD de fuentes y para informar errores; los permisos de medios deben agregarse explícitamente en el proceso principal. |
| Persistencia | SQLite + migraciones Drizzle; settings tipados y validados | Una tabla propia para fuentes es más sólida que guardar un JSON abierto dentro de settings. |
| Audio actual | Audio y videos de biblioteca se sincronizan/reporter desde la ventana de proyección | El audio de la capturadora requiere una decisión explícita; no debe entrar por accidente al PA. |

Archivos de referencia: `src/shared/types/projection.ts`, `src/renderer/src/stores/projection.store.ts`, `src/renderer/src/components/shared/output-view.tsx`, `src/renderer/src/projection/ProjectionApp.tsx`, `src/main/services/projection-state.ts` y `src/main/ipc/handlers/projection.ts`.

## Alcance y caminos posibles

### Camino A — UVC / cámara USB / capturadora HDMI→USB

La cámara o capturadora aparece como un `MediaDeviceInfo` de tipo `videoinput`; la aplicación lista las entradas y la ventana de proyección solicita la elegida con `getUserMedia({ video: { deviceId: { exact } } })`. OBS Virtual Camera también entra en este mismo camino.

Ventajas:

- No agrega binarios nativos, FFmpeg ni una licencia nueva.
- Funciona con la familia más común de capturadoras USB UVC y webcams.
- La imagen llega directo a un `<video srcObject={stream}>`, sin grabarla ni transcodificarla dentro de WorshipApp.
- Reutiliza la arquitectura actual de proyección y overlays.

Límites:

- No cubre una cámara HDMI/SDI conectada *directamente* al equipo: requiere que un hardware/driver la exponga como entrada de video.
- La calidad, latencia y framerate dependen de la capturadora, USB, cámara y sistema operativo; hay que negociar y mostrar el modo realmente concedido.
- El `deviceId` no es una identidad física permanente. Se debe guardar además la última etiqueta y presentar “reconectar/seleccionar de nuevo” si cambia.
- Dos ventanas adquiriendo la misma capturadora pueden fallar o aumentar carga. El capture agent será el único propietario y entregará la misma sesión a preview y proyección.

**Factibilidad:** alta. Es el primer adaptador que se debe implementar dentro del capture agent, no una razón para que el renderer se convierta en el dueño de la cámara.

### Camino B — NDI como entrada de red

Este es distinto al plan existente `plans/ndi-integration/analisis.md`, que analiza que WorshipApp sea un **emisor** NDI. Aquí WorshipApp debería ser un **receptor** NDI: descubrir fuentes en LAN, seleccionar una, decodificar video/audio y entregar frames al renderizador.

Ventajas: permite recibir el programa de OBS/vMix o una cámara sobre red sin una capturadora local. Desventajas: SDK y runtime nativos por plataforma, empaquetado/códigos de firma, descubrimiento mDNS, gestión de red y una ruta de frames que no existe hoy. Debe ser un proyecto posterior con un spike de compatibilidad y licencia, aun si el modelo de `ExternalVideoSource` de V1 lo deja entrar como `kind: "ndi"`.

**Factibilidad:** media-alta, pero complejidad y riesgo de distribución altos. No recomendado como primer entregable.

### Camino C — RTSP/SRT/HLS/WebRTC y cámaras IP

Un `<video>` de Chromium no reproduce RTSP de forma nativa. Para RTSP/SRT se necesita un receptor y normalmente un puente/transcodificador local (por ejemplo, FFmpeg/GStreamer) hacia un formato reproducible, o una integración WebRTC específica. HLS es más simple de reproducir pero normalmente introduce varios segundos de latencia. WebRTC puede ser de baja latencia pero exige señalización/autenticación.

Esto debe modelarse como un adaptador de entrada independiente, no como una URL arbitraria cargada en el DOM. Admitir URLs libres sin política de red/autenticación empeora seguridad y soporte.

**Factibilidad:** variable. **Recomendación:** diferir hasta saber qué protocolo entrega el hardware real.

### Camino D — capturar otra pantalla/aplicación del equipo

Electron también puede usar `getDisplayMedia`/`desktopCapturer`, útil para una demostración o recibir el output de una aplicación local. No es una capturadora de cámara y puede crear retroalimentación si se selecciona la pantalla donde está el proyector. Tratarlo como una fuente futura separada, con advertencias y selector del sistema; no mezclarlo con las cámaras en V1.

## Arquitectura propuesta

```
                            SQLite: ExternalVideoSource
                                      ▲        │
Panel Fuentes ──IPC CRUD/configurar───┘        │ ProjectionOutput { sourceId }
                                                ▼
Control renderer ─────────────── Main process / gestor de sesión
                                        │ inicia, detiene, autoriza
                                        ▼
                     capture-agent nativo (un solo dueño de la fuente)
       ┌───────────────────────┬──────────────┬─────────────────────────┐
       │ UVC / HDMI-USB        │ NDI receiver │ RTSP / SRT / RIST        │
       │ AVFoundation/DShow/   │ SDK NDI      │ GStreamer/network stack  │
       │ V4L2 + audio SO       │              │                           │
       └───────────────────────┴──────────────┴─────────────────────────┘
                                        │ A/V WebRTC sobre loopback, token efímero
                                        ▼
                    Projection renderer: <video srcObject={MediaStream}>
                    pantalla completa + audio; persistente bajo NEGRO/LOGO
```

El **capture agent** es un sidecar nativo empaquetado junto a la aplicación (recomendación: Rust/C++ con GStreamer, no un proceso `ffmpeg` armado con strings). Main lo supervisa, le habla por un protocolo local versionado y le entrega una credencial efímera. El agent sólo escucha en `127.0.0.1` y nunca expone una entrada remota sin autenticación. WebRTC local es el contrato entre el motor nativo y el renderer: conserva video y audio sincronizados, evita pasar frames por IPC y permite que la ventana de control tenga una previsualización como segundo peer sin abrir dos veces la misma cámara.

GStreamer es el candidato principal para el agent porque reúne fuentes de hardware y red, y su `webrtcbin` implementa la negociación WebRTC. No es una dependencia liviana: se deben empaquetar los runtimes y plugins exactos por plataforma. NDI y DeckLink siguen siendo adaptadores optativos con sus propios SDK/runtime, no plugins que se puedan asumir presentes en cada instalación.

Principios que no se deben negociar:

1. **Estado serializable, stream local.** El estado guarda sólo `sourceId`, parámetros y `epoch`; el `MediaStream` WebRTC queda en el renderer y los buffers nativos dentro del agent.
2. **Un dueño de la entrada.** El agent abre cada fuente una vez y puede alimentar proyección + preview como consumidores. Al cambiar o cerrar, termina el pipeline y libera hardware/puertos.
3. **Overlay no equivale a apagar la entrada.** NEGRO/LOGO cubren la imagen y conservan la captura, pero mutean su audio. Al salir del overlay el audio vuelve al nivel previo, igual que en el flujo actual de video.
4. **Audio integrado, sin duplicación.** El agent recibe audio junto al video, preserva timestamps y WebRTC lo entrega a la ventana de proyección. Sólo esa ventana debe emitirlo; preview y monitores se mantienen muteados. La UI necesita medidor, mute, volumen y selección explícita de la entrada de audio asociada.
5. **Negociación, no promesa de formato.** Cada adaptador enumera sus modos; el operador elige `auto` o una preferencia. El agent reporta resolución, fps, codec, canales y modo finalmente obtenidos.
6. **Degradación visible para el operador.** Una fuente ausente, permiso denegado, dispositivo ocupado, timeout o stream finalizado deja al público en el fallback configurado y produce un estado accionable en la ventana de control; nunca un stack trace sobre la proyección.

### Modelo de datos sugerido

Crear una migración y tabla `external_video_sources`:

| Campo | Uso |
| --- | --- |
| `id` (UUID) | Identidad estable usada por el programa/estado. |
| `name` | Nombre editable: “Cámara escenario”. |
| `kind` | `uvc`, `ndi`, `rtsp`, `srt`, `rist`, `decklink` o `screen`; cada binario sólo habilita los adaptadores instalados y probados. |
| `connection_json` | Configuración validada y versionada por adaptador (dispositivo, URI, modo, codec/preset), nunca una pipeline/command string libre. |
| `device_id` | Último identificador del dispositivo local cuando aplica. |
| `last_device_label` | Diagnóstico y ayuda para relocalizar si cambia el id. |
| `video_constraints_json` | Preset deseado (1080p30, 720p30, automático), no valores arbitrarios sin validar. |
| `audio_config_json` | Dispositivo/entrada, canalización, mute y nivel; la clave secreta o contraseña nunca va aquí en texto plano. |
| `created_at`, `updated_at` | Auditoría básica. |

Agregar tipos DTO y canales IPC `externalVideo:list/create/update/delete`, junto con una API de sesión (`start`, `stop`, `status`, `previewOffer/answer`). La enumeración puede provenir del agent, que ve tanto dispositivos nativos como fuentes NDI; no depende sólo de la API web. El DTO recibido por main se valida contra un esquema cerrado antes de persistirlo. Las contraseñas de RTSP/SRT o tokens van en almacenamiento seguro del SO (`safeStorage`), referenciados desde la configuración, nunca en SQLite, logs o IPC de estado. No incorporar estas fuentes a la biblioteca de archivos ni a la caché de medios: no son archivos, no tienen thumbnail durable y no deben participar de prewarm, hash ni eliminación de assets.

### Cambios de tipos y render sugeridos

- Agregar `BaseContent` con `kind: "external-video"`, `sourceId` y `epoch`.
- Agregar una variante serializable de `ProjectionOutput` que incluya `sourceId` y el identificador de sesión. El output no debe incluir el objeto `MediaStream`, configuración con contraseñas ni buffers.
- Generalizar `VideoUnderlay` a una unión de video de archivo y sesión de entrada externa, o introducir un `externalVideoUnderlay` paralelo. La primera opción conserva el contrato de “la fuente base sigue viva debajo de overlays”; elegir la variante que deje el switch exhaustivo más legible.
- En `OutputView`, crear `LiveExternalVideo`: negocia WebRTC con el agent a través de main, asigna el stream recibido por `element.srcObject`, llama `play()`, reacciona a conexión/track finalizado y cierra el peer al desmontarse. No usa `src`, seek ni autoplay de biblioteca.
- Introducir estados de sesión específicos (`starting`, `connecting`, `live`, `reconnecting`, `unavailable`, `permission-denied`, `device-busy`, `timed-out`, `ended`) y eventos agent→main→control. Reutilizar el patrón de `media-error` sólo a nivel visual; no forzar los errores de captura dentro de `ProjectionMediaError`, que hoy modela URLs y elementos de archivos.

### Permisos y empaquetado

Hay dos rutas que deben tratarse de forma distinta. El spike UVC directo de Chromium exige configurar los handlers de permiso `media` de Electron antes de abrir cualquier ventana, concediendo sólo video/audio a los `webContents` propios y orígenes locales esperados. El diseño final abre dispositivos desde el agent nativo: su permiso TCC/privacidad y firma deben probarse dentro del bundle empaquetado; no se debe suponer que el permiso del renderer le será heredado.

En macOS se debe:

- declarar `NSCameraUsageDescription` en el `Info.plist` generado por electron-builder;
- declarar también `NSMicrophoneUsageDescription` porque el alcance incluye audio;
- validar en el spike qué binario (app/agent) dispara el consentimiento y que firma, entitlements y `Info.plist` son aceptados por TCC;
- probar la ruta de usuario que negó permiso, ya que macOS pide cambiarlo en Ajustes y reiniciar para aplicar un cambio.

En Windows se debe detectar/explicar el bloqueo de privacidad global de cámara y micrófono. En Linux se debe validar V4L2/PipeWire, permisos de grupo/portal y servidor de audio en una distribución objetivo antes de declarar soporte operativo.

## Plan de implementación propuesto

### Fase 0 — contrato de producto y matriz de soporte

1. Publicar que “abierto” significa **adaptadores explícitos**, no soporte universal implícito. Primera matriz: UVC/capturadora USB, NDI receiver, RTSP, SRT y RIST. DeckLink/SDI entra sólo tras su SDK y prueba específica.
2. Elegir los sistemas de CI y las arquitecturas de release: macOS arm64/x64, Windows x64 y una distribución Linux concreta (por ejemplo Ubuntu LTS x64). “Linux” sin una distribución objetivo no es verificable.
3. Definir perfiles de salida: `auto`, `preferir 1080p30`, `preferir 1080p60`, `720p30` y `custom` sólo para adaptadores capaces. El modo concedido siempre se muestra.
4. Implementar la política ya decidida: NEGRO/LOGO mutean el audio de la sesión externa sin detener el pipeline. Al quitar el overlay se restaura el volumen previo; mute manual y overlay deben conservarse como estados independientes.

### Fase 1 — spike del motor nativo y del transporte (la puerta principal)

1. Implementar un capture-agent mínimo, supervisado por Electron main, que abra **una** fuente UVC con video + audio y exponga una sola sesión WebRTC local autenticada.
2. Probarlo empaquetado, no sólo desde el repo, en los tres sistemas. Verificar primer frame, sincronía A/V, stop/restart, desconexión/reconexión y cierre abrupto de app.
3. Medir el modo concedido, tiempo de primer frame, uso CPU/GPU, frames perdidos y latencia end-to-end con 720p30, 1080p30 y el máximo ofrecido por el dispositivo. El presupuesto confirmado es **≤ 1 segundo** end-to-end, medido desde la entrada hasta el proyector; no fijar un umbral de resolución universal.
4. Elegir la estrategia de runtime: GStreamer incluido con los plugins mínimos y versiones bloqueadas. Documentar tamaño, firma/notarización, licencias y vulnerabilidades antes de expandir adaptadores.

**Gate:** continuar sólo si el agent mantiene audio y video sincronizados, se recupera de una desconexión y no deja procesos/dispositivos retenidos en macOS, Windows y la distribución Linux objetivo.

### Fase 2 — dominio, seguridad y control de sesión

1. Crear migración, repositorio, DTOs versionados y validación de `external_video_sources`.
2. Declarar IPC para CRUD y control de sesión, y un protocolo main↔agent con mensajes tipados: `enumerate`, `start`, `stop`, `status`, `offer`, `answer`, `ice`, `health`.
3. Proteger el bridge: endpoint loopback con token de un uso/vida corta, allowlist de `webContents`, tamaño máximo de mensajes y nunca exponer credenciales al renderer.
4. Guardar secretos con `safeStorage` y establecer cómo se comporta una instalación donde el keychain/secret service no está disponible.
5. Integrar permisos de cámara/micrófono para UVC y los textos/entitlements de macOS; para Windows/Linux, convertir bloqueos del SO en diagnóstico accionable.

### Fase 3 — primer adaptador completo: UVC con audio

1. Enumerar desde el agent la cámara/capturadora y sus modos de video/audio, crear fuente, nombrarla, elegir perfil y probarla.
2. Crear una preview WebRTC muteada compartiendo la sesión del agent, con medidor de audio y el modo realmente negociado.
3. Extender `BaseContent`, selector de output y acciones EN VIVO para `external-video`.
4. Implementar `LiveExternalVideo` en la ventana de proyección, con audio habilitado solamente allí, lifecycle completo de peer/stream y eventos de salud.
5. Integrar NEGRO, LOGO, fallback, transiciones y reapertura. Se acepta corte de imagen antes que una transición que introduzca buffers o desincronice A/V.

### Fase 4 — adaptadores de red, uno a la vez

1. **NDI receiver:** discovery/selección, audio/video, reconexión y métricas de frames; empaquetar runtime y revisar términos de distribución del SDK.
2. **RTSP:** URI, credenciales seguras, TCP/UDP elegible, certificado y un perfil de baja latencia. `rtspsrc` tiene buffering y timeouts propios; exponerlos como presets, no como knobs crudos.
3. **SRT/RIST:** listener/caller, passphrase/keys seguros, puertos/firewall y diagnóstico de red.
4. **DeckLink/SDI:** spike por plataforma/SDK, detección de formato de entrada y canales de audio. Sólo convertirlo en fuente soportada tras pruebas con hardware físico.

Cada adaptador agrega su propio contrato de configuración, tests de integración y entradas a la matriz de soporte. No fusionar dos adaptadores en un mismo release inicial.

### Fase 5 — endurecimiento y release

1. Pruebas unitarias de la variante `external-video`, overlays, política de audio y validación de configuración.
2. Tests de protocolo con el agent simulado: oferta/respuesta, caída, timeout, reconexión, token inválido, fuente ocupada y cambio de modo.
3. Pruebas de humo con una fuente real por adaptador y plataforma; 30–60 minutos continuos por perfil operativo.
4. Empaquetar e instalar en máquinas limpias macOS, Windows y Linux; probar permisos, firewall, firma/notarización y runtime faltante.
5. Publicar matriz de compatibilidad, guía de conexión y captura de diagnósticos sanitizada (sin URIs con credenciales).

## Criterios de aceptación del primer release operativo

- Una capturadora UVC conectada, con su audio, aparece, se puede nombrar, seleccionar y probar desde un agent único.
- El operador puede enviar la fuente a pantalla completa. La proyección recibe una sola sesión A/V sincronizada; previews y monitores no emiten audio.
- NEGRO/LOGO conservan la entrada sin reiniciarla y mutean su audio; al retirar el overlay restauran el nivel previo. Cambiar a otra fuente o cerrar la proyección libera el pipeline.
- La aplicación recupera el output tras reabrir la ventana de proyección y vuelve a negociar la sesión local, o informa claramente que no puede hacerlo.
- El panel muestra resolución, fps, codec, audio/canales y estado efectivamente negociados, no sólo lo solicitado; el perfil probado debe cumplir una latencia end-to-end de hasta un segundo.
- Un fallo o desconexión nunca bloquea el proceso ni deja una imagen falsa: control muestra el diagnóstico y el público queda en un fallback seguro.
- El instalador macOS muestra los textos de permiso correctos; Windows y Linux presentan una explicación accionable cuando SO, privacidad o permisos del dispositivo bloquean la entrada.
- El capture agent y sus plugins se detienen con la app y no aceptan conexiones que no sean loopback autenticado.

## Riesgos y mitigaciones

| Riesgo | Mitigación |
| --- | --- |
| Capturadora no UVC o driver inestable | Publicar una lista de hardware probado; el spike define la frontera. Para HDMI/SDI profesional, activar el adaptador DeckLink/SDK sólo tras pruebas específicas. |
| Cambia `deviceId` tras reconectar | Persistir etiqueta y preset; resolver con confirmación del operador, nunca elegir silenciosamente otra cámara. |
| Cámara ocupada / error del SO | Mapear `NotReadableError` a un mensaje específico y ofrecer reintentar. |
| Permiso denegado | Estado visible, enlace/instrucción por plataforma y no solicitarlo al iniciar. |
| Preview compite con salida | El agent es el único dueño de la entrada y entrega peers WebRTC independientes; no abrir la cámara desde dos renderers. |
| Latencia excesiva | Medir en Fase 0 con el hardware final; preferir 1080p30/720p30 sobre un 1080p60 inestable. No prometer una cifra que depende de la capturadora. |
| Audio duplicado o fuera de sync | Sólo la ventana de proyección reproduce el audio por la salida predeterminada del sistema; WebRTC y el agent comparten clock A/V. NEGRO/LOGO aplican mute sin detener el pipeline. |
| Fuente de red se cuela como “sólo una URL” | Mantener `kind` de adaptador y validar configuración; cada protocolo trae su backend, secretos seguros y pruebas. |
| Runtime nativo demasiado grande o difícil de firmar | Resolverlo en el spike empaquetado y bloquear versiones/plugins; no incorporarlo mediante una descarga silenciosa en runtime. |
| “Multiplataforma” sin equivalencia de drivers | Mantener una matriz por SO, arquitectura, fuente y versión; el contrato es común, pero la compatibilidad no se presume. |

## Extensiones posteriores, sólo después del primer release operativo

1. Adaptadores NDI, RTSP, SRT, RIST y DeckLink, en el orden de prioridad operativa que se decida, uno a la vez.
2. Screen capture: `getDisplayMedia` con selector controlado y protección contra capturar el proyector.
3. Composición: cámara como fondo con letra/lower-third. Es otro requisito visual; la decisión actual es pantalla completa.
4. Grabación, salida NDI y streaming: consumidores adicionales del agent, no capturas independientes de la misma fuente.

## Decisiones cerradas para iniciar el spike

| Tema | Decisión |
| --- | --- |
| Composición | Fuente externa a pantalla completa. |
| Audio | Se captura y reproduce sólo desde la ventana de proyección, usando la salida predeterminada del sistema. |
| NEGRO / LOGO | Mutean audio y cubren imagen; no cierran la entrada. |
| Resolución | Auto-negociada; se muestra el modo conseguido. |
| Latencia | Hasta 1 segundo end-to-end. |
| Plataformas | macOS, Windows y Ubuntu LTS x64 como Linux inicial. |
| Prioridad de adaptadores | UVC/capturadora con audio → NDI receiver → RTSP → SRT/RIST → DeckLink/SDI. |

## Segunda tanda de decisiones (2026-10-07)

| Tema | Decisión |
| --- | --- |
| Arquitectura | **Capture agent nativo desde el spike**, como recomienda este plan. Se descartó arrancar con `getUserMedia` en el renderer. |
| Lenguaje del agent | **Rust + gstreamer-rs** (`native/capture-agent/`). |
| GStreamer en desarrollo | **Framework oficial `.pkg`** (runtime + devel) en `/Library/Frameworks`: es relocatable, que es lo que se empaqueta. No Homebrew. |
| Señalización | Main lanza el agent como proceso hijo y la señalización (offer/answer/ICE) viaja por **stdio, JSON por línea**. No hay socket que escuche ni token: las huellas DTLS sólo pasan por ese canal privado, y eso autentica el SRTP por loopback. |
| Monitores | **Imagen real, muteada.** PREVIEW y LIVE son peers WebRTC adicionales de la misma sesión del agent; sólo la ventana de proyección reproduce audio. |
| Modelo | **Fila guardada + ítem del orden de culto**, como Escenas y Placas: tabla propia, CRUD por IPC, `program_items.kind = 'input'` (migración a mano como 0011/0015), modal de gestión. |
| Hardware objetivo | Sin hardware definido: «todo lo que se pueda». Se mantiene la prioridad de adaptadores de arriba; el spike usa una Logitech C270 (UVC + micrófono). |
| Plataformas del gate | **macOS primero.** El gate de Windows y Ubuntu queda abierto y explícito hasta tener máquinas físicas con cámara. |
| Alcance del spike | **Cableado a la app desde ya**, no un harness aislado: el agent entra en main y la pestaña Entradas durante el spike. |

## Fuentes consultadas

- [Electron `session`: permisos de media y `setPermissionRequestHandler`](https://www.electronjs.org/docs/latest/api/session). Electron enumera `media` para cámara/micrófono y exige combinar el check con un request handler para un manejo completo.
- [Electron `systemPreferences`: estado y solicitud de permisos de cámara](https://www.electronjs.org/docs/latest/api/system-preferences). En macOS se requiere consentimiento y `NSCameraUsageDescription`; Windows tiene un control global de privacidad de cámara.
- [MDN: `MediaDevices.getUserMedia()`](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia). Define la solicitud de una cámara por `deviceId`, constraints de resolución/framerate y los errores que hay que exponer al operador.
- [MDN: `MediaDevices.enumerateDevices()`](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/enumerateDevices). Base para listar `videoinput`, sus etiquetas e informar cambios de dispositivos.
- [Electron `desktopCapturer`](https://www.electronjs.org/docs/latest/api/desktop-capturer). Referencia para la futura variante de captura de pantalla, deliberadamente fuera de V1.
- [GStreamer `webrtcbin`](https://gstreamer.freedesktop.org/documentation/webrtc/). Base del puente A/V WebRTC local entre el motor nativo y Electron.
- [GStreamer `v4l2src`](https://gstreamer.freedesktop.org/documentation/video4linux2/v4l2src.html), [AVFoundation](https://gstreamer.freedesktop.org/documentation/applemedia/avfvideosrc.html) y [DirectShow](https://gstreamer.freedesktop.org/documentation/directshow/dshowvideosrc.html). Referencias de los backends locales que cubren Linux, macOS y Windows.
- [GStreamer RTSP](https://gstreamer.freedesktop.org/documentation/rtsp/rtspsrc.html) y [SRT](https://gstreamer.freedesktop.org/documentation/srt/srtsrc.html). Referencias para adaptadores de red; RTSP tiene buffering/timeout propios y SRT modos de conexión distintos.
- [NDI Receive SDK](https://docs.ndi.video/all/developing-with-ndi/sdk/ndi-recv). El receptor entrega frames de audio y video, mantiene una cola y reconecta fuentes; por ello merece su adaptador nativo dedicado.
- [FFmpeg Devices](https://ffmpeg.org/ffmpeg-devices.html). Confirmación independiente de las rutas AVFoundation, DirectShow, V4L2 y DeckLink, y de que DeckLink requiere su SDK de Blackmagic.
