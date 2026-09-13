# 03 — Pipeline de diapositivas (LibreOffice headless)

Reemplaza por completo la integración COM/PowerShell con PowerPoint. Ya **no** hay nada
Windows-only: la app corre y se valida igual en macOS, Windows y Linux.

## El cambio de modelo

Antes: *control remoto de un slideshow vivo de PowerPoint* — main sostenía un cursor de
diapositiva, PowerShell lo movía, y los PNG eran un subproducto efímero en `os.tmpdir()`.

Ahora: **un deck es contenido**. Se convierte una sola vez y se cachea; main ya no tiene un cursor
de diapositiva, tiene un **cache**. Ese solo replanteo es lo que borra `ppt:next/prev/goto/
currentSlide/close` — el cursor vive en el store del renderer y es la única copia.

## El pipeline

```
.pptx ──soffice --convert-to pdf──► PDF ──pdfjs en ventana oculta──► WebP por slide
   │                                                                      │
   └──parseo OOXML (fflate + fast-xml-parser)──► timings + audio ─────────┴──► SQLite + disco
```

`soffice --convert-to png` **solo exporta la primera diapositiva** — de ahí el paso por PDF.

## Por qué el rasterizado va en una `BrowserWindow` oculta

Rasterizar necesita un Canvas2D real. La alternativa (`@napi-rs/canvas` en un `utilityProcess`)
publica su binario nativo como `optionalDependency` **por plataforma**: a diferencia de
`better-sqlite3` (8 binarios en un tarball), `npm install` en macOS nunca baja el de Windows, así
que cross-compilar el instalador de Windows desde una Mac — cosa que este proyecto hace — shippearía
una app rota. Una ventana oculta ya es su propio proceso del SO, así que el aislamiento ante un
crash es el mismo, sin ese riesgo.

Se usa el build **legacy** de pdf.js (`pdfjs-dist/legacy/build/pdf.mjs`): el bundle moderno usa
built-ins que el Chromium de Electron 36 todavía no tiene y falla con
`n.toHex is not a function`.

**Esa ventana se reutiliza entre decks** (una sola, con apagado por inactividad a los 60 s — que
durante un batch nunca llega). Consecuencia para cualquier cambio en `slides/rasterizer.ts`: todo
lo que se registre *por job* sobre su `webContents` hay que desregistrarlo al terminar el job. Un
`once("render-process-gone")` no alcanza: `once` sólo se saca a sí mismo si el evento dispara, así
que acumulaba un listener por deck convertido — con su closure y el `pages`/`request` de ese job
colgados — hasta que Node avisaba
`MaxListenersExceededWarning: 11 render-process-gone listeners added to [WebContents]` a mitad de
preparar una carpeta. El `finish()` del job es el único lugar correcto para esa limpieza.

## Identidad por hash de contenido

`slide_decks` se identifica por `(content_hash, render_width, image_format)`, **no** por
`media_asset_id`. Dos entradas de biblioteca que apuntan a copias del mismo archivo comparten una
conversión, y mover el archivo es un hit de cache en vez de reconvertir. Hay un fast-path previo
por `(size, mtime)` que ni siquiera hashea.

El hash sí lee el archivo entero, pero por `fs/promises` y de a 1 MB: las lecturas van al thread
pool y el `hash.update` queda acotado al chunk, no al tamaño del deck. Sincrónico, un `.pps` de
60 MB congelaba el hilo que atiende al proyector durante toda la lectura.

### La contracara: la fila tiene un solo dueño

`media_asset_id` sí existe en la fila, y `relinkDeck` lo **mueve** cuando otro asset resuelve al
mismo contenido. O sea: la conversión se comparte, pero la *pertenencia* es exclusiva. Todo lo que
pregunta "¿este asset está convertido?" mirando `media_asset_id` —`statusesByAsset`, y con él la
cuenta de "Preparar carpeta", los badges de los tiles y los pins de desalojo de `adoptProgram`—
está haciendo una pregunta de pertenencia sobre un caché de contenido, y se equivoca en cuanto hay
dos archivos idénticos: uno figura convertido y el otro no, para siempre.

**Es un defecto abierto, no una sutileza teórica:** `N3` en
[`auditorias/reports/2026-09-11-cadena-de-media.md`](../../auditorias/reports/2026-09-11-cadena-de-media.md)
§5.2, medido en 555 falsos pendientes sobre 1235 assets con 0 trabajo real. No cuentes filas por
asset para saber qué falta convertir.

## Alineación de timings — el detalle que importa

**LibreOffice NO exporta las diapositivas ocultas al PDF** (verificado contra un deck real). Por
eso los timings se alinean contra las diapositivas **visibles** (`!hidden`), no contra la lista
completa del OOXML: hacerlo mal corre cada timing una posición por cada slide oculta. Si los
conteos igual no coinciden (una animación que LibreOffice parte en varias páginas), se descartan
**todos** los timings (`timings_source = 'none'`) — un auto-avance desalineado en silencio es peor
que no tener auto-avance.

## Parseo OOXML

Las partes se leen con `readZipEntries` (`src/main/slides/zip-reader.ts`), **nunca** cargando el
archivo entero. Un `.pptx` es un zip y un zip es de acceso aleatorio: se ubica el
end-of-central-directory (con zip64), se parsea el directorio central y se leen solo los rangos de
bytes pedidos — unos KB, sin importar cuántos MB de media haya alrededor. `unzipSync` con `filter`
**no** sirve para esto: recibe un buffer, así que evita el inflate pero no el `readFileSync`.

Dos detalles que no son obvios y están medidos en
[`.claude/knowledge/a-pptx-is-random-access-and-inflatesync-needs-its-out-buffer.md`](../../.claude/knowledge/a-pptx-is-random-access-and-inflatesync-needs-its-out-buffer.md):
el lector es **síncrono a propósito** (lecturas de KB, así que nada de la cadena de llamadores —
hasta `MediaRepo.ensureLinkedAudio` y `toDeckDTO` — tuvo que volverse `async`), y a `inflateSync`
hay que pasarle el buffer `out` con el tamaño que ya trae el directorio central: sin eso, el
crecimiento de su propio buffer de salida cuesta ~16 µs por entrada y hace que la versión "rápida"
sea 3× más lenta que leer el archivo completo.

- `ppt/presentation.xml` → `<p:sldIdLst>` da el **orden real**. `slide1.xml, slide2.xml…` es el
  orden de creación y diverge apenas alguien reordena.
- El `<p:transition>` casi nunca está en la raíz del slide en decks modernos: vive en
  `mc:AlternateContent/mc:Choice[@Requires="p14"]`, con copia en `mc:Fallback`. Se revisan las tres
  formas. Mirar solo la suelta es la forma más común de leer cero timings sin darse cuenta.
- `@advTm` (ms de auto-avance), `@advClick`, `p:sld/@show="0"` (oculta).
- Audio: `p:pic` con `a:audioFile` + los `_rels` del slide; `p:cMediaNode` da loop/volumen.
  OOXML no tiene un booleano de "suena en todo el deck" — es una heurística documentada
  (`loop` o `repeatCount="indefinite"` ⇒ `scope: "deck"`).
- `.ppt`/`.pps` binarios (OLE2, no zip): se convierten **también** a `.pptx` con una segunda pasada
  de LibreOffice para recuperar estructura y audio embebido (`timings_source = 'ooxml-converted'`).

## Los timings de un binario legacy NO salen del `.pptx` convertido

El round-trip a `.pptx` **pierde el auto-avance** de toda diapositiva que no tenga un efecto visual
de transición: el filtro de exportación de LibreOffice solo escribe el elemento `<p:transition>`
cuando hay un efecto, y `advTm` es un atributo de ese elemento. Medido sobre el himnario real del
usuario: los 1226 archivos tienen auto-avance en el origen y **222 lo pierden** en la conversión.
La importación de LibreOffice está bien — el mismo archivo exportado a `.odp` conserva cada
`presentation:duration`; es solo su exportador de PPTX.

Por eso los tiempos se leen del **binario de origen**, no del convertido:

- `src/main/slides/ppt-binary-timings.ts` lee `SlideShowSlideInfoAtom` del stream
  `PowerPoint Document` del OLE2, en orden de presentación (`Current User` → `UserEditAtom` →
  directorio de persistencia → `SlideListWithText` de instancia 0 → `SlidePersistAtom`). Nunca lee
  el archivo entero: las imágenes viven en el stream `Pictures`, así que son ~45 KB de un archivo
  de 1,4 MB, leídos por sectores bajo demanda.
- `mergeBinaryTimings` (en `deck-service.ts`) **solo rellena huecos** y se autoverifica: compara
  las dos lecturas donde ambas tienen número y, ante una sola discrepancia, abandona el merge
  entero. Un deck que avanza con el tiempo de otra diapositiva en pleno culto es peor que uno que
  no avanza.
- `src/main/slides/backfill-timings.ts` aplica lo mismo hacia atrás, a los decks ya convertidos,
  **sin reconvertir nada** — los tiempos están en el origen, así que es releer y `UPDATE`.

Diagnóstico completo y las trampas del formato (los bits de `fFlags` no son consecutivos;
`PP97_DUALSTORAGE`) en
[`.claude/knowledge/libreoffice-pptx-export-drops-advtm-without-a-transition-effect.md`](../../.claude/knowledge/libreoffice-pptx-export-drops-advtm-without-a-transition-effect.md).

## Aislamiento de LibreOffice

`-env:UserInstallation=file://<userData>/soffice-profile` es **obligatorio**: un perfil propio
significa un lock y un named pipe propios, así que una copia de LibreOffice abierta por el usuario
como app normal ni roba nuestro comando ni nos bloquea. El perfil se calienta una vez por versión
al arrancar (`slides.profileWarmedVersion`).

En Windows se prefiere **`soffice.com` antes que `soffice.exe`**: el `.exe` se desacopla y devuelve
antes de que el PDF exista; el `.com` bloquea hasta terminar.

Los argumentos van siempre como array de `argv`, nunca como string de shell — y el nombre del
filtro va **sin comillas** (`pptx:Impress MS PowerPoint 2007 XML`), porque unas comillas literales
pasan a ser parte del nombre del filtro y LibreOffice lo rechaza.

Dos reglas más de la invocación, aprendidas en la auditoría del 2026-09-11:

- **`stdout` va a `ignore`, no a `pipe`.** Un pipe que nadie lee se llena (~64 KB) y **bloquea al
  hijo** hasta que el timeout lo mata — indistinguible de "LibreOffice se colgó". `--convert-to`
  imprime una línea por archivo convertido, así que un lote suficientemente grande llega solo.
  Nadie lee stdout: las salidas se descubren listando `--outdir`. `stderr` sí se lee, acotado.
- **Una invocación de lote necesita su propio `AbortController`.** No pertenece a ningún `Job`, así
  que ninguna señal por job la detiene, y `sofficeChain` serializa todo contra el perfil
  compartido: sin ese controller, un `deck:ensure` interactivo esperaba detrás del chunk entero
  (hasta 30 minutos de `convertTimeoutForBatch`). `tryPreemptForInteractive` lo aborta.

### Matarlo de verdad

`soffice` se lanza `detached` (grupo propio, para que `killTree` alcance a `soffice.bin` detrás de
`soffice`), y eso significa que **sobrevive a main**. Un `soffice` vivo retiene el lock y el named
pipe del perfil compartido, y ahí todas las conversiones del arranque siguiente fallan en silencio
— justo lo que el perfil propio existe para evitar. Dos defensas, porque una sola no alcanza:

- **Al salir:** SIGTERM y SIGKILL en la **misma llamada sincrónica** (`killTree(child, immediate)`;
  `execFileSync` en Windows). En `before-quit` no corre nada asíncrono — el `setTimeout` de respaldo
  que había antes no se ejecutó nunca.
- **Al arrancar:** `reapOrphanedSoffice()` mata lo que haya quedado de un crash (que se saltea
  `before-quit` entero), filtrando por **nuestro propio** `-env:UserInstallation`, así que una copia
  de LibreOffice del usuario nunca se toca. No hay equivalente en Windows sin PowerShell/WMI: ahí el
  huérfano lo sigue limpiando `resetSofficeProfile` después de los timeouts.

Detalle completo en
[`.claude/knowledge/nothing-asynchronous-survives-before-quit.md`](../../.claude/knowledge/nothing-asynchronous-survives-before-quit.md).

## Progreso: por página sólo para lo interactivo

`deck-progress` se emite **por página rasterizada únicamente para jobs `interactive`**
(`emitPageProgress`). Para trabajo de fondo salen sólo las transiciones de estado; el progreso
agregado del lote viaja por `prewarm-progress`. Emitir el por-página también en fondo convertía una
carpeta de 600 decks en ~18.000 mensajes IPC, cada uno clonando en el renderer un `Record` que
crece con cada deck — ver
[`.claude/knowledge/an-aggregate-progress-channel-only-helps-if-the-per-item-one-goes-quiet.md`](../../.claude/knowledge/an-aggregate-progress-channel-only-helps-if-the-per-item-one-goes-quiet.md).

## Se acabó la danza del overlay

Como una diapositiva ahora es un `<img>`, la ventana de proyección **nunca se esconde**. NEGRO y
LOGO son resultados normales de `selectOutput`, y el canal `projection:setOverlayVisible`
desapareció. El audio del deck sigue sonando durante NEGRO — verificado.

## Servido

`worship://deck/<deckId>/<n>[/thumb]` resuelve contra `deck_slides` y se sirve con
`Cache-Control: public, max-age=31536000, immutable` — el par `(deckId, slideIndex)` es inmutable
por construcción (otro contenido ⇒ otro hash ⇒ otro deckId). Sin ese header Chromium releería cada
imagen en cada cambio de diapositiva, en vivo. El audio (`worship://deck-audio/<id>`) va sin ese
header porque se recorre con seek, no se reemplaza.

Todo lo que sirve `worship://` pasa por `serveFile()`, que implementa **semántica real de
`Range`** (206 + `Content-Range`, `Accept-Ranges: bytes`, 416, streaming con
`fs.createReadStream({start,end})`). Antes delegaba en `net.fetch(file://…)` sin reenviar los
headers, lo que dejaba a todo video/audio **sin seek** y rompía la reproducción con
`PIPELINE_ERROR_DECODE (-12909)` por datos desalineados — ver
[`.claude/knowledge/worship-protocol-range-and-video-lifecycle.md`](../../.claude/knowledge/worship-protocol-range-and-video-lifecycle.md).

## Verificación sin levantar la app

```bash
npm run slides:smoke -- "ruta/al/archivo.pptx"
```

Cubre discovery de soffice, conversión a PDF, el round-trip de `.ppt` legacy, orden de
diapositivas, timings, slides ocultas y extracción de audio. El rasterizado no entra ahí porque
necesita el canvas de Chromium — eso solo corre dentro de la app.
