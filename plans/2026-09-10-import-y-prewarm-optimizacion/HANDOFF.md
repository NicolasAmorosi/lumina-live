# Handoff — Optimización de importación masiva y pre-conversión de presentaciones

**Fecha:** 2026-09-11
**Estado:** Fases 1, 2, 2.5, 3 y **3.5 implementadas**. Barra mínima verde (`typecheck` + `lint` +
`db:smoke` 13/13). La Fase 3.5 (abajo) **sí se verificó contra la app corriendo y contra la
biblioteca real del usuario**, midiendo por CDP y mirando capturas. Lo que sigue pendiente es la
prueba a mano de las Fases 2.5 y 3 en la pantalla del usuario (lista al final).
**Ver también:** `PLAN.md` (el diseño de referencia de las tres fases) y
`~/.claude/plans/estamos-trabjando-con-este-greedy-pine.md` (el plan de Fase 2.5, con el
diagnóstico completo de los dos síntomas que la motivaron).

---

## Cómo retomar esto en una sesión nueva

1. Leé `PLAN.md` completo primero — es el diseño de referencia.
2. Leé este archivo entero — dice qué se implementó tal cual, qué se simplificó (y por qué) y
   qué queda pendiente de probar a mano.
3. Corré la barra mínima para confirmar que seguís en verde antes de tocar nada:
   ```bash
   npm run typecheck && npm run lint && npm run db:smoke
   ```
4. Antes de tocar miniaturas, leé
   `.claude/knowledge/nativeimage-thumbnail-blocking-and-generic-icon.md` — tiene las mediciones
   que decidieron la implementación, y las dos trampas de `nativeImage` que no están en su
   documentación.

---

## Fase 3.5 — Tiles rotos, skeletons y prioridad del programa (2026-09-11, tarde)

Plan: `~/.claude/plans/acabamos-de-terminar-la-humble-feigenbaum.md`. Motivada por tres cosas que
el usuario reportó al probar la Fase 3.

### A. La causa raíz de "todas las miniaturas tienen formatos incorrectos"

**Un `<button>` se dimensiona shrink-to-fit incluso siendo `display:flex`.** Mientras `ThumbTile`
era el grid item, `justify-items: stretch` le daba el ancho de la celda gratis; al envolverlo en el
`div[role="listitem"]` de `VirtualGrid` (que es el que ahora ocupa la celda), su ancho pasó a ser
**el del texto de su etiqueta**. La Fase 3 agregó `h-full` y no `w-full`.

Medido sobre la app corriendo, en una grilla de columnas de 119,39 px: el deck "001" medía **34,59
px** de ancho, y tres videos **161,47 / 266,78 / 217,44** px, solapándose entre sí. Un arreglo de
una clase (`w-full` en `thumb-tile.tsx`). Diagnóstico completo, con el motivo de que la medición
anterior no lo viera (se midió una **réplica** del marcado, donde el tile sí era grid item), en
`.claude/knowledge/tile-height-uniformity-flex-min-height-and-grid-auto-rows.md`.

De paso, dos defectos más de geometría:

- `itemHeight` ignoraba el borde de 1 px del tile. La aritmética se mudó a
  **`components/ui/thumb-tile.geometry.ts`** (`thumbTileHeight`, `THUMB_TILE_LABEL_PX`,
  `THUMB_TILE_BORDER_PX`), que además mantiene sano el Fast Refresh: exportar una función desde el
  módulo del componente lo rompía (`hmr invalidate … "thumbTileHeight" export is incompatible`) e
  invalidaba todo el árbol en cada edición del tile.
- `VirtualGrid` se quedaba con el ancho medido **antes** de que apareciera la barra de scroll (627
  en vez de 621): la altura de la grilla decide si `PanelBody` scrollea, esa barra cambia el ancho
  de la grilla, y Chrome resuelve esos loops de `ResizeObserver` **descartando** notificaciones.
  Ahora `recomputeWindow()` relee `clientWidth` en cada recálculo, y la grilla **no pinta nada
  hasta tener un ancho real** — el fallback viejo (`columnWidth = minItemWidth`) pintaba una única
  columna a todo el ancho con la altura de una de 112 px, que es la otra mitad de lo que el usuario
  veía. Se agregó además una aserción sólo-dev que avisa una vez si el tile mide distinto de lo que
  `itemHeight()` declaró.

### B. Estado de carga de las miniaturas

- `ThumbTile` gana `loading?: boolean` y, por dentro, seguimiento del `src` que efectivamente
  cargó: mientras no hay imagen decodificada se pinta un `Skeleton` **encima** del área de media
  (absoluto, cero impacto en la geometría) y el tile queda `aria-busy`.
- `AssetTile` pasó de `deckThumbUrl: string | null` a `deckStatus?: DeckStatusSummary | null` con
  tres estados reales: `undefined` = todavía no se consultó (skeleton), `null` = consultado y sin
  deck (icono), summary = hay deck. Sin esa distinción el tile no podía decidir entre "cargando" y
  "no convertido", y un skeleton eterno sobre 600 decks mentiría.
- El skeleton también cubre la ventana entre "terminó de convertir" y "llegó la miniatura" (el
  refetch de statuses está debounceado 500 ms): sin eso el tile volvía al icono ~0,6 s, que se lee
  como un fallo. Se apoya en `deckStatus.thumbUrl`, **no** en la URL ya resuelta, para que una
  miniatura cuyo archivo fue desalojado caiga al icono en vez de quedarse bajo el skeleton.
- **Primer `deck:statuses` inmediato**: la única llamada pasaba por el debounce de 500 ms, así que
  una pestaña de decks ya convertidos mostraba iconos medio segundo. Ahora se distingue "abrí una
  vista" (inmediato) de "terminó un deck de los que ya estaban en pantalla" (debounceado), con
  `fetchedForRef`.

### C. Lane de prioridad para el programa

`backgroundQueue: Job[]` → `backgroundQueue: Record<PrewarmScope, Job[]>` con
`BACKGROUND_LANES = ["program", "explicit", "visible", "batch"]`, drenadas en ese orden
(`pump()` = `interactiveQueue.shift() ?? dequeueBackground()`). FIFO por lane, O(1), sin
comparadores. `PrewarmScope` gana `"program"`, y el contrato de `deck:prewarm` con él.

- **Promoción entre lanes** (`promoteBackgroundLane`): sólo hacia adelante, así que un scroll no
  puede degradar algo que el operador puso en el programa. Y `prewarmExplicit` dejó de saltarse los
  assets `inFlight` — ese `continue` era exactamente lo que impedía promover un deck ya encolado.
- `program.store.ts`: `addItem` encola con scope `"program"`, y **`loadProgram` encola todos los
  PPT sin convertir del programa**, en orden del culto (decisión del usuario: sólo al abrir un
  programa guardado; no al arrancar la app, no al reordenar).
- `warmBatchPdfCache` se saltea también si hay trabajo encolado en `program`/`explicit`: una
  invocación de `soffice` por chunk de 20 bloquearía la cola justo lo que esta prioridad existe
  para evitar.
- **La preemption no se tocó**: sigue siendo sólo interactiva. El programa se adelanta por
  ordenamiento, nunca abortando una conversión — el riesgo del perfil compartido de `soffice`
  queda intacto.

### Verificación real de esta fase

Medida sobre **la app corriendo con la biblioteca real del usuario** (622 PPT, 64 videos), por
CDP: `electron-vite dev -- --user-data-dir=<copia de userData> --remote-debugging-port=9222`, más
`Runtime.evaluate` para los rects y `Page.captureScreenshot` para mirar el resultado. La copia de
`userData` evita el lock de instancia única y no toca la biblioteca real.

- **Geometría, a tres anchos de ventana** (1920 / 1400 / 1000 → 5 / 3 / 2 columnas): ancho del tile
  **igual al de la columna** (119,39 / 145,22 / 154,16), altura uniforme (92 / 107 / 112) e igual a
  `gridAutoRows`, separación entre filas exactamente altura + gap (98 / 113 / 118), relación de
  aspecto del área de media 1,77–1,78 (16:9 = 1,778). Antes: anchos de 34 a 267 px en la misma
  grilla.
- **`SlideGrid` idéntico antes y después**: 292,5 × 165,41 el tile, 290,5 × 163,41 el área de
  media. `w-full` es no-op cuando el tile ya es grid item.
- **Virtualización**: con 622 tiles, a `scrollTop` 8000 el rango montado arranca en el índice 395 y
  hay **55 nodos** en el DOM (50 de la ventana + 5 de la fila con foco, que se mantiene montada a
  propósito).
- **Ciclo de carga de una conversión real** (deck 35, forzado): skeleton + loader indeterminado →
  skeleton + barra de progreso determinada → miniatura, sin ningún salto al icono en el medio.
- **Prioridad**: batch de 10 decks; a los 4 s se pide `deck:prewarm(["program"])` sobre un deck que
  estaba **último** en el batch y sobre uno nunca encolado. Orden real de conversión observado por
  `deck-progress`: `369, 380, 383, 370, 372, 374, 375, 376, 377, 378, 379` — los dos del programa
  se adelantan, el que ya estaba encolado se promueve, y el job en curso (369) no se aborta ni se
  repite.
- `typecheck` + `lint` + `db:smoke` (13/13) verdes.
- **Trampa de la verificación, ahora documentada**: una ventana ocluida no corre el rendering
  lifecycle (`visibilityState: "hidden"`, 0 frames en 500 ms, 0 eventos de scroll), así que la
  virtualización **parecía** no seguir el scroll. `Page.captureScreenshot` fuerza un frame y
  desbloquea la sonda. Ver
  `.claude/knowledge/occluded-electron-window-has-no-rendering-lifecycle.md`. Corolario: en esa
  ventana no se pueden medir **tiempos** (React difiere el trabajo), sólo geometría.

### Archivos de esta fase

```
nuevo:      src/renderer/src/components/ui/thumb-tile.geometry.ts
nuevo:      .claude/knowledge/occluded-electron-window-has-no-rendering-lifecycle.md
modificado: CLAUDE.md                                             (regla no-negociable: h-full Y w-full)
modificado: .claude/knowledge/tile-height-uniformity-...md         (la mitad del ancho, del mismo bug)
modificado: src/renderer/src/components/ui/thumb-tile.tsx          (w-full, loading + Skeleton, onLoad)
modificado: src/renderer/src/components/ui/virtual-grid.tsx        (syncWidth, no pintar sin medir, aserción dev)
modificado: src/renderer/src/components/ui/index.ts
modificado: src/renderer/src/components/pages/resources/asset-tile.tsx      (deckStatus tri-estado, loading)
modificado: src/renderer/src/components/pages/resources/media-browser.tsx   (statuses|null, fetch inmediato)
modificado: src/main/slides/deck-service.ts                        (lanes de fondo + promoción + guarda del batch)
modificado: src/main/ipc/handlers/slides.ts
modificado: src/shared/ipc/contract.ts                             (deck:prewarm scope "program")
modificado: src/renderer/src/lib/api.ts
modificado: src/renderer/src/stores/program.store.ts               (addItem + loadProgram con scope "program")
modificado: src/main/slides/rasterizer.ts                          (fuga de listeners render-process-gone)
modificado: docs/knowledge/03-slides-libreoffice.md                (la ventana del rasterizador se reutiliza)
```

### D. Fuga de listeners del rasterizador (arreglada después, a pedido del usuario)

`MaxListenersExceededWarning: 11 render-process-gone listeners added to [WebContents]` era real:
`rasterizePdf()` registraba un `once("render-process-gone")` **por job** sobre la `webContents` de
la ventana del rasterizador, que se **reutiliza** entre decks (apagado por inactividad a los 60 s,
que durante un batch nunca llega). `once` sólo se desregistra si el evento dispara, así que se
acumulaba uno por deck convertido, cada uno reteniendo el closure con el `pages`/`request` de su
job. No producía rechazos falsos (el guard `settled` los volvía no-op), pero era una fuga y tapaba
cualquier otro warning de listeners.

Arreglo: el handler es una función nombrada y `finish()` hace
`contents.off("render-process-gone", …)` (con `isDestroyed()` de guarda, porque tras un crash leer
`win.webContents` puede tirar). La `webContents` se captura una vez, antes de la promesa.

Verificado: **19 conversiones reales en una sola vida de la ventana** (un batch de 5 + 14
reconversiones forzadas por `deck:ensure {force:true}`) → **0 warnings**. La corrida anterior, con
el código viejo y ~10 conversiones, había emitido 2. La regla subió a
`docs/knowledge/03-slides-libreoffice.md`: la ventana se reutiliza, así que todo lo registrado por
job sobre su `webContents` se desregistra en `finish()`.

---

## Fase 3 — Virtualización y miniaturas (2026-09-11)

Implementada íntegra. Dos decisiones se consultaron con el usuario antes de escribir código,
porque `PLAN.md` las dejaba abiertas:

- **La miniatura de un PPT llega por `deck:statuses`**, que pasó de devolver
  `Record<id, DeckStatus>` a `Record<id, DeckStatusSummary>` (`{status, thumbUrl}`). El `SELECT`
  de `SlidesRepo.statusesByAsset` ya corría: agregar la columna `id` del deck es coste cero, y
  la URL se arma con `slideThumbUrl(deckId, 1)`. Alternativa descartada: resolver el PPT dentro
  de `worship://asset/<id>/thumb`, porque al terminar la conversión la URL no cambiaría y el 404
  cacheado se quedaría pegado.
- **El caché de miniaturas se limpia por antigüedad al arranque** (`pruneThumbCache`, 60 días,
  diferido 10 s). Sin esto crecería para siempre: `size+mtime` es parte de la clave, así que
  editar un archivo huerfaniza su JPEG viejo y nada más lo borraría.

### 3.1 `components/ui/virtual-grid.tsx` (nuevo)

Tal cual el plan: **sin scroller propio** — resuelve su ancestro scrolleable
(`findScrollParent`, que en la práctica es siempre `PanelBody`) y escucha su scroll. Así el
`onDrop` de archivos del SO sigue cubriendo toda el área útil y no hay doble barra.

- Geometría: `columns = floor((width + gap) / (minItemWidth + gap))`, ancho por `ResizeObserver`,
  handler de scroll `passive` que sólo pide un `rAF`, y `setRowWindow` **sólo si cambió la fila**.
- `itemHeight` es una función de `columnWidth`; `THUMB_TILE_LABEL_PX` se exporta ahora desde el
  barrel de `ui/` para que el número no se duplique.
- Accesibilidad, junto con la virtualización y no después: `role="list"`/`listitem` con
  `aria-setsize`/`aria-posinset`, **roving tabindex** (`ThumbTile` ganó `tabIndex`), flechas +
  `Home`/`End` con scroll al índice, y la fila enfocada se mantiene montada aunque salga de la
  ventana (se renderiza como un segundo `RowBlock` posicionado aparte) para que el foco no caiga
  al `<body>` al scrollear.
- **Agregado sobre el plan:** `onFocusCapture` sincroniza el rover con lo que realmente tiene el
  foco. Sin eso, un click en el tile 50 dejaba el rover en el 0 y la flecha siguiente saltaba al
  principio de la grilla.

### 3.2 `src/main/media/thumbnail-service.ts` (nuevo)

Clave por `path + size + mtime + MEDIA_THUMB_VERSION + width` (sha1, 32 hex), archivos en
`userData/thumb-cache/<ab>/<key>.jpg`, **sin tabla en la DB** — el nombre es el índice. Escritura
atómica `.tmp-<uuid>` + `rename`. `Map<key, Promise>` in-flight + semáforo de 4 con yield.

**El path se incluye en la clave, no sólo `size+mtime` como decía el plan**: dos archivos
distintos comparten tamaño y mtime con facilidad (cualquier export por lotes), y servir la
miniatura de uno para el otro sería un bug silencioso y desconcertante.

Lo importante de esta parte no fue el código sino la **medición** — está entera en
`.claude/knowledge/nativeimage-thumbnail-blocking-and-generic-icon.md`. Resumen:
`createFromPath`+`resize` congela el hilo de main los 782 ms que tarda en hacer 10 imágenes 4K;
`createThumbnailFromPath` hace las mismas 10 en 35 ms sin bloquear. Se usa el segundo para
imagen **y** video, con el primero sólo como fallback (Linux, o un archivo que el SO rechace).
Y el thumbnailer del SO devuelve el **icono genérico de Finder (512×512)** para un archivo que
no puede parsear, mientras `getSize()` miente (reporta el `maxSize` pedido) — por eso
`readJpegSize()` lee el SOF del JPEG y se rechaza todo lo que exceda el `maxSize` pedido.

Se sirve on-demand desde `worship-protocol.ts` (`case "asset"`, sub-ruta `/thumb`), sin canal
IPC previo. 404 con `Cache-Control: no-store` cuando no hay miniatura; el JPEG va `immutable`
porque `assetThumbUrl(id, version)` **exige** el cache-buster (omitirlo es error de compilación).
`MediaAsset` ganó `mtimeMs`, que la columna ya tenía y el DTO no mapeaba.

### 3.3 `asset-tile.tsx` simplificado

- Se cayó el `<video preload="metadata">` por tile (un pipeline de decodificación por tile
  visible) y el hook `useDeckThumb`, **borrado en el mismo commit** junto con sus IPC por tile.
- Cadena de fallback por URL, no por flag booleano: miniatura → (sólo imagen) archivo completo →
  icono del kind. La rama del archivo completo evita una regresión real: un `.gif`/`.webp`/`.bmp`
  que el fallback in-process no decodifica antes se veía perfecto porque el tile apuntaba
  directo al archivo.
- El prewarm "visible" pasó del techo duro de Fase 2.5.G a un **rango real**
  (`onVisibleRangeChange`), con `PREWARM_VISIBLE_MAX` degradado a backstop.

### 3.4 Uniformidad de los tiles — regresión reportada por el usuario y corregida

Al probar la Fase 3 el usuario reportó que las miniaturas se veían **de distintos tamaños** según
el contenido (y peor todavía mientras cargaban), y que las filas de abajo quedaban desalineadas.
Era real y lo había introducido esta fase. Se reprodujo de forma objetiva antes de tocar nada:
se replicó el marcado exacto de `ThumbTile` en una página con el CSS compilado de la app y se
midió con `getBoundingClientRect()` en un `BrowserWindow` oculto. Diez tiles que debían medir
93 px medían **entre 63,88 y 103,88 px**, y la altura declarada de la grilla difería 18 px de la
real.

Dos causas independientes, ambas documentadas en
`.claude/knowledge/tile-height-uniformity-flex-min-height-and-grid-auto-rows.md`:

1. **`aspect-video` no sobrevive a ser un flex item.** El `min-height: auto` implícito deja que
   el tamaño intrínseco de la imagen mande sobre la relación de aspecto, en los dos sentidos: una
   foto enorme estira la caja, una de 40×40 la encoge. Arreglo en `thumb-tile.tsx`: `min-h-0` +
   `grow` en el área de medios y `h-full` en el tile.
2. **`VirtualGrid` posiciona un *bloque* de filas, no cada fila.** Con `gridAutoRows: auto` sólo
   la primera fila del bloque caía donde la geometría virtual decía y las de abajo se iban
   corriendo. Arreglo: `gridAutoRows: rowHeight - gap`.

De paso apareció un tercer defecto más callado: **`THUMB_TILE_LABEL_PX = 24` era una estimación**
de lo que darían `text-xs` + `py-1`, y `VirtualGrid` posiciona filas contra ese número. Ahora la
etiqueta tiene esa altura de forma explícita (`h-6`/`leading-6`). Una constante de la que se
deriva un layout tiene que estar impuesta por el CSS, no estimada a partir de él.

Verificado tras el arreglo: los diez casos dan **93 px de tile y 67 px de área de medios exactos**
(los 2 px de diferencia contra el 16:9 ideal son el borde del tile), la altura del spacer coincide
con la del contenido, y `SlideGrid` (filas por contenido: versículos y diapositivas) mide
**idéntico antes y después** en sus dos variantes.

> Trampa a recordar si se vuelve a armar un banco de pruebas así: Tailwind sólo emite las clases
> que aparecen en el código fuente, así que una clase probada **sólo** dentro del harness no hace
> nada y el harness da un falso PASS. `h-6` medía 0 px hasta usarla de verdad en `thumb-tile.tsx`
> y recompilar el CSS.

### Bug latente arreglado de paso

`MediaRepo.upsertFromPath` (rama de fila existente) y `relocate()` devolvían el `sizeBytes`/
`mtimeMs` **anterior**, no el que acababan de escribir. Era inocuo hasta ahora; con el
cache-buster de la miniatura construido sobre esos dos valores, habría dejado tiles apuntando a
la miniatura del archivo viejo. Cubierto por el paso `[12/13]` nuevo de `db-smoke.ts`.

### Verificación real de esta fase

- `npm run typecheck && npm run lint && npm run db:smoke` — verde (13/13, con el paso 12 nuevo).
  `npm run build` — verde.
- La app **arranca** con `npm run dev` sin excepciones y el prune corre sin warning.
- **`nativeImage` probado a mano contra archivos reales** (probes en un scratch dir, no quedaron
  en el repo — mismo criterio que la prueba de `convertBatchToPdf` de Fase 2.5): PNG 4K de 10 MB,
  JPEG 4K, GIF, MP4 1280×720, un `.png` corrupto y una ruta inexistente. Resultado: los cuatro
  archivos válidos dan `320×180` con el aspecto correcto; el corrupto se detecta como icono
  genérico (`512×512`) y se rechaza; el inexistente tira y se traga. **32 generaciones de un PNG
  4K: 19 ms totales, stall máximo del hilo de main 12 ms** (línea base ociosa: 20 ms).
- **NO verificado, requiere la carpeta real del usuario + mirar la pantalla:**
  0. ~~Que todos los tiles midan igual sin importar el contenido.~~ **Hecho en la Fase 3.5**: no
     medían igual (era el `w-full` faltante), ya está medido y mirado con la biblioteca real a tres
     anchos de ventana.
  1. Scrollear ~600 tiles **a 60 fps** — el rango montado y la cantidad de nodos ya se verificaron
     en la Fase 3.5 (55 nodos de 622), pero los fps hay que verlos en una ventana visible.
  2. Navegación por teclado: un solo Tab entra a la grilla, las flechas se mueven, el foco no se
     pierde al scrollear lejos y volver.
  3. Arrastrar un tile al schedule sigue funcionando (el `onDrop` de `PanelBody` no se tocó, pero
     la grilla ahora está posicionada en absoluto adentro).
  4. Reemplazar un archivo de imagen en disco y confirmar que la miniatura se actualiza
     (cache-buster).
  5. Un `.gif` o `.webp` en la biblioteca: tiene que seguir viéndose, vía el fallback al archivo
     completo.
  6. Con algo EN VIVO, abrir la pestaña de Imágenes/Videos de una carpeta grande y confirmar que
     la proyección no se traba.

### Archivos nuevos de esta fase

```
src/main/media/thumbnail-service.ts
src/renderer/src/components/ui/virtual-grid.tsx
.claude/knowledge/nativeimage-thumbnail-blocking-and-generic-icon.md
```

### Archivos borrados

```
src/renderer/src/lib/hooks/use-deck-thumb.ts   (sin consumidores tras 3.3)
```

### Archivos modificados en esta fase

```
scripts/db-smoke.ts                                   (paso 12 nuevo: el DTO devuelve el size/mtime recién escrito)
src/main/index.ts                                     (pruneThumbCache diferido al arranque)
src/main/paths.ts                                     (thumbCacheDir / thumbCachePath)
src/main/protocol/worship-protocol.ts                 (sub-ruta /thumb en case "asset")
src/main/db/repositories/media.repo.ts                (mtimeMs en el DTO; upsertFromPath/relocate devuelven lo escrito)
src/main/db/repositories/slides.repo.ts               (statusesByAsset -> DeckRowSummary con deckId)
src/main/services/prewarm-service.ts                  (deckStatuses devuelve {status, thumbUrl})
src/main/slides/deck-service.ts                       (3 call-sites de statusesByAsset)
src/shared/constants.ts                               (MEDIA_THUMB_*; comentario de PREWARM_VISIBLE_MAX)
src/shared/urls.ts                                    (assetThumbUrl / assetThumbVersion)
src/shared/types/media.ts                             (MediaAsset.mtimeMs)
src/shared/types/deck.ts                              (DeckStatusSummary)
src/shared/ipc/contract.ts                            (deck:statuses -> DeckStatusSummary)
src/renderer/src/components/ui/index.ts               (VirtualGrid, THUMB_TILE_LABEL_PX)
src/renderer/src/components/ui/thumb-tile.tsx         (prop tabIndex)
src/renderer/src/components/pages/resources/asset-tile.tsx     (sin <video>, sin useDeckThumb, cadena de fallback)
src/renderer/src/components/pages/resources/media-browser.tsx  (VirtualGrid, rango visible real, statuses con thumbUrl)
```

---

## Fase 2.5 — Corrección del bucle de import y del estado falso de conversión (2026-09-10)

Motivada por dos síntomas reales del usuario probando una carpeta de ~624 `.pps/.ppt` legacy con
auto-avance y música: la barra de import parpadeando sin parar, y un cartel falso de
"Convirtiendo… N de N" al mandar EN VIVO un deck ya preparado. Diagnóstico completo, con
file:line de cada causa, en el plan de Fase 2.5 (ruta arriba). Resumen de lo que se hizo:

### A. Roto el bucle de import (causa raíz del síntoma 1)

`library:listFolder` (`src/main/ipc/handlers/library.ts`) llamaba `importPaths()`, que
**siempre** terminaba emitiendo `library-changed` — y el renderer (`library-sync.ts`) respondía
a ese evento llamando `refreshFolder()`, que volvía a llamar `listFolder`. Bucle infinito
mientras la pestaña PPT estuviera sobre una carpeta vinculada grande.

- `MediaRepo.upsertBatch` ahora devuelve `{ assets, mutated }` en vez de solo el array.
- `importPaths(paths, kind, opts)` gana `opts.emitChanged` (default `true`) y sólo
  broadcastea `library-changed` cuando `mutated > 0`. `library:listFolder` pasa
  `emitChanged: false` explícitamente (ya devuelve la lista fresca a su caller).
- `ImportProgress` gana `status: "running" | "done"` — el fin del import ya no depende de
  `library-changed` para limpiarse; `library-sync.ts` limpia la barra en `status === "done"`.
- El primer evento de progreso no sale hasta `PROGRESS_MIN_DELAY_MS = 400`ms desde el arranque
  — una carpeta estable no muestra barra en absoluto.
- **Regla nueva, documentada en `.claude/knowledge/list-channel-must-never-broadcast-its-own-refetch-signal.md`:** un canal `list*` nunca debe broadcastear el evento que dispara su propio re-fetch.

### B. `deck:statuses`/prewarm sin 1200 `existsSync` por vuelta

`SlidesRepo.statusesByAsset(assetIds)` — un solo `IN (...)` en vez de un `getDeck()`
(SELECT + `fs.existsSync`) por asset. Usado por `prewarm-service.ts`'s `deckStatuses` y
`startPrewarmBatch`, y por `prewarmExplicit`/`setVisiblePrewarm` en `deck-service.ts`.

### C. El cache-hit se resuelve antes de la cola (causa raíz del síntoma 2)

`tryCacheHit(assetId, sourcePath, force)` extraída de `runConversion` y llamada
**sincrónicamente dentro de `prepareDeck`, antes de tocar `inFlight`/las colas**. Un deck ya
preparado resuelve al instante, sin encolarse y sin anunciar "converting" — antes esperaba
detrás de cualquier conversión de fondo en curso. `emitProgress({status:"converting"})` se movió
a después de los chequeos de caché (ya no se emite en un cache-hit). Preemption de background
bajada de 1.5s/10s a 0.6s/3s (`PREEMPT_MIN_RUNTIME_MS`/`PREEMPT_MIN_INTERVAL_MS`), segura porque
ahora sólo dispara sobre conversiones genuinas.

### D. La UI dejó de mentir

- `deck.store.ts`'s `ensure()`: si el deck ya está `ready` en el store, no flipea a
  `converting` (igual dispara el IPC en paralelo, para el `touchDeck`/relink). Cuando sí
  flipea, resetea `progress` a `{0,0}` en vez de heredar el conteo anterior — eso era lo que
  producía el "8 de 8" falso.
- `deck-slides.tsx`: si `entry.deck` ya tiene slides, sigue pintando la grilla aunque
  `status === "converting"` — antes la tiraba y volvía a mostrarla, un parpadeo visible.
- `playback.ts`'s `goLiveWithDeck`: si el store ya tiene el deck `ready` con slides, va en vivo
  con eso de inmediato y dispara `ensure()` en paralelo para revalidar, en vez de esperar el
  round-trip.

### E. Batching de LibreOffice para el prewarm de fondo

- `libreoffice.ts` gana `convertBatchToPdf`/`convertBatchToPptx`: una sola invocación de
  `soffice` con N rutas de origen y un `--outdir`, en vez de una invocación por archivo.
  Emparejamiento salida→origen por basename normalizado (NFC+lowercase). Best-effort: si la
  invocación se cancela o timeoutea, matchea lo que ya se alcanzó a convertir y el resto cae al
  camino de a uno.
- `deck-service.ts` gana `warmBatchPdfCache(assetIds)`: pre-convierte un chunk de
  `SLIDES_BATCH_SIZE = 20` decks de fondo con una invocación de PDF y (para legacy) una de
  `.pptx`, dejando los resultados en `precomputedPdfByAsset`/`precomputedPptxByAsset` — que
  `runConversion`/`readMetadata` prefieren sobre su propio `soffice` de un solo archivo cuando
  están presentes. Cada asset "libera" su entrada al terminar (éxito, error, o cache-hit temprano);
  el directorio temporal compartido del chunk se borra solo cuando todos los assets del chunk
  lo liberaron.
- Se salta el warming por completo si hay un job interactivo corriendo o esperando: abortar una
  invocación de lote (una sola `soffice` para N archivos) tiraría el progreso de TODOS, no de
  uno — exactamente lo que la preemption existe para evitar.
- `prewarm-service.ts`'s `runBatch` llama `warmBatchPdfCache` en cada frontera de chunk; el
  loop por-asset (progreso, cancelación, presupuesto de caché) queda igual que antes.
- **No se tocó** la disciplina de `sofficeChain` (la cadena que serializa todo `soffice` contra
  el perfil compartido) — los batch calls pasan por el mismo `runSoffice`.

### F. `resolveLinkedAudio` sin leer el deck entero

`extractHintFromBinary` (`linked-audio.ts`) escaneaba el archivo completo con `readFileSync` y
lo convertía a dos strings de tamaño completo (`utf16le`+`latin1`) — para un `.pps` de 40MB,
~120MB de allocation síncrono por deck. Reemplazado por un escaneo en chunks de 4MB con
solapamiento de 512 bytes (`HINT_SCAN_CHUNK_BYTES`/`HINT_SCAN_OVERLAP_BYTES`).

`resolveLinkedAudio` también gana un `dirCache?: Map<string, string[]>` opcional para que un
caller que resuelva muchos decks de la misma carpeta comparta el `readdirSync` — **no está
conectado a ningún caller todavía** (no existe hoy un "resolver muchos a la vez"; el único
consumidor, `MediaRepo.ensureLinkedAudio`, resuelve de a un asset). Queda como superficie lista
para cuando haga falta, documentado como corte de alcance deliberado, no una promesa rota.

### G. Techo del prewarm automático "visible"

`PREWARM_VISIBLE_MAX = 32` (`shared/constants.ts`). `media-browser.tsx` corta la lista de ids
visibles a ese máximo antes de pedir `deck:prewarm(..., "visible")` — sin virtualización,
"visible" seguía siendo "toda la vista actual", que para una carpeta de 600 podía encolar los
600. El resto sigue siendo alcanzable por el botón manual "Preparar carpeta".

### Verificación real de esta fase

- `npm run typecheck && npm run lint && npm run db:smoke` — verde. `db-smoke.ts` ganó el paso
  `[10/12]`: `upsertBatch` sobre un set ya importado y sin cambios reporta `mutated === 0` (el
  test de regresión del bucle, corre sin Electron).
- **Prueba real de `convertBatchToPdf` contra archivos `.pptx` reales**, hecha a mano en esta
  sesión (no quedó como test automatizado en el repo): se generaron 5 `.pptx` reales a partir de
  las plantillas que trae LibreOffice (`/Applications/LibreOffice.app/.../template/common/presnt/*.otp`
  convertidas con `soffice --convert-to pptx`), una de ellas renombrada con acentos y espacios
  (`Cántico de alabanza (Señor).pptx`) para forzar el caso NFC/NFD. Una sola invocación de
  `soffice --convert-to 'pdf:impress_pdf_Export' --outdir <dir> *.pptx` convirtió los 5 —
  incluida la de nombre acentuado — y el emparejamiento por basename normalizado
  (`normalizedBase`/`matchOutputsToSources`) resolvió los 5 correctamente. Confirma que el
  supuesto central del batching (LibreOffice acepta múltiples archivos de origen en una sola
  invocación y produce una salida por basename) es válido en esta máquina.
- **No verificado en esta sesión, porque requiere Electron + la carpeta real del usuario:** las
  cinco pruebas manuales del plan de Fase 2.5 (bucle muerto contra los 624 `.pps` reales, go-live
  instantáneo de un deck prewarmeado incluso con un batch corriendo, la regresión del `.pps`+`.mp3`
  hermano sonando la primera vez, cronometrar "Preparar carpeta" antes/después del batching, y
  que la proyección no se trabe con algo EN VIVO). **Quedan pendientes de que el usuario las
  corra con `npm run dev`.**

### Archivos nuevos de esta fase

Ninguno — todo se hizo editando los archivos existentes de Fase 1/2.

### Archivos modificados en esta fase

```
scripts/db-smoke.ts                                 (paso 10 nuevo: mutated===0 en re-import estable)
src/main/db/repositories/media.repo.ts               (upsertBatch devuelve {assets, mutated})
src/main/db/repositories/slides.repo.ts              (statusesByAsset)
src/main/ipc/handlers/library.ts                     (listFolder pasa emitChanged:false)
src/main/services/library-import.ts                  (emitChanged, status running/done, delay inicial)
src/main/services/prewarm-service.ts                 (statusesByAsset, warmBatchPdfCache por chunk)
src/main/slides/deck-service.ts                      (tryCacheHit sincrónico, batch precompute+release, preemption 0.6s/3s)
src/main/slides/libreoffice.ts                       (convertBatchToPdf/Pptx, convertTimeoutForBatch, matchOutputsToSources)
src/main/slides/linked-audio.ts                      (scan en chunks, dirCache opcional)
src/renderer/src/components/pages/resources/media-browser.tsx  (PREWARM_VISIBLE_MAX)
src/renderer/src/components/pages/slides/deck-slides.tsx        (mantiene la grilla en converting)
src/renderer/src/effects/library-sync.ts             (limpia la barra por status:"done", no por library-changed)
src/renderer/src/lib/actions/playback.ts             (goLiveWithDeck usa el store si ya está ready)
src/renderer/src/stores/deck.store.ts                (ensure no flipea si ya ready; progress se resetea)
src/renderer/src/stores/library.store.ts             (sin cambios funcionales — imports ya soportaba el shape)
src/shared/constants.ts                              (SLIDES_BATCH_SIZE, PREWARM_VISIBLE_MAX)
src/shared/types/media.ts                            (ImportProgress.status)
```

---

## Qué se hizo (Fase 1 y Fase 2 — sin cambios respecto de la versión anterior de este handoff)

### Fase 1 — Import no bloqueante ✅ implementada tal cual el plan

- **`MediaRepo.upsertFromPath`/`upsertBatch`** (`src/main/db/repositories/media.repo.ts`) ya no
  llaman `findLinkedAudio()` al importar. Insertan con `linkedAudioResolvedVersion: 0` y dejan
  que `ensureLinkedAudio()` (ya existía) resuelva la primera vez que el deck se abre de verdad.
- **`toDeckDTO(row, assetId, { resolve })`** en `deck-service.ts`: `getDeck` (cache-only, o sea
  `deck:get`) pasa `resolve: false`; todo lo demás (que ya pasó por una conversión real o un
  cache-hit) sigue resolviendo por default. Esto es lo que evita que el prewarm de la Fase 2
  mude el mismo problema (leer 600 archivos enteros) un nivel más abajo.
- **`src/main/services/library-import.ts`** (nuevo): `importPaths(paths, kind, opts)` —
  lotes de 100, una transacción por lote (`MediaRepo.upsertBatch`, con
  `INSERT ... ON CONFLICT(path_key) DO UPDATE` atómico), yield al event loop entre lotes,
  serializado con un lock a nivel proceso (`withImportLock`).
- **`MediaRepo.sweep()`** pasó a ser `async`, chunkeado de a 200 filas con yield, y escribe con
  `UPDATE ... WHERE id IN (...)` en vez de un UPDATE por fila. Ya no corre en cada
  `library:list` (que ahora es un SELECT puro) — corre desde:
  **`src/main/services/library-sweeper.ts`** (nuevo): al arranque (+2s vía debounce), en
  `browser-window-focus` (throttle 30s) y cada 5 min sólo con ventana enfocada.
- Se **emite** `library-changed` (existía en el contrato, nunca se disparaba) y se agregó
  `library-import-progress` (sólo si `paths.length > 200`, throttle ≤4/s) — **ver Fase 2.5,
  sección A: la condición de emisión de `library-changed` cambió**.
- Canal muerto **`files:probe`** eliminado (contrato, handler, `api.ts`) — dependía de la misma
  `findLinkedAudio` que se estaba sacando del camino caliente y no tenía consumidores.
- Renderer: `library.store.ts` gana `imports: ImportProgress | null` +
  `applyImportProgress`/`clearImportProgress`; nuevo efecto
  **`src/renderer/src/effects/library-sync.ts`** suscrito a `library-changed` (refresca la
  vista afectada) y a `library-import-progress`.

**Verificación real, no sólo tipos:** se extendió `scripts/db-smoke.ts` con un test que importa
25 archivos por batch, confirma que `linkedAudioPath` nunca se resuelve eager, prueba la
reactivación OR-no-sobreescritura contra una fila desactivada a mano, y prueba `sweep()`
marcando/desmarcando un archivo como missing.

**Lo único no verificado en Fase 1:** la prueba manual con `npm run dev` contra una carpeta real
de ~600 `.pptx` — el usuario la corrió después y encontró los dos síntomas que motivaron la
Fase 2.5 (arriba).

### Fase 2 — Prewarm con prioridad y progreso ✅ implementada, con simplificaciones deliberadas

- **Dos colas en `deck-service.ts`**: `interactiveQueue`/`backgroundQueue`, `pump()` drena la
  interactiva primero. `prepareDeck(assetId, opts)` reemplazó la firma vieja
  `prepareDeck(assetId, force)` — sólo tenía un call-site (`deck:ensure`), se actualizó.
- **Soft-preemption**: un job `background` corriendo se aborta si llega uno `interactive` y
  lleva corriendo el umbral configurado (ver Fase 2.5.C: bajado de 1.5s/10s a 0.6s/3s), con
  máximo 2 intentos por job antes de dejarlo terminar. La cancelación **no toca
  `consecutiveTimeouts`** (se verificó explícitamente, es el riesgo que documenta
  `.claude/knowledge/soffice-shared-profile-race.md`). Setting `slides.preemptBackground`
  (default `true`) como interruptor de emergencia sin release.
- **El bug del LRU está arreglado**: `insertDeck` backdatea `lastUsedAt` 25h cuando el job es
  `background`, así que un deck prewarmeado y nunca abierto es el primer candidato a desalojo,
  no inmune por 24h. `pinDeck` se generalizó a `pinDecks(reason, ids)` y se conectó desde
  `projection:show`: el deck que está en el proyector está protegido de desalojo.
- **`src/main/services/prewarm-service.ts`** (nuevo): `startPrewarmBatch`/`cancelPrewarmBatch`/
  `deckStatuses`, con presupuesto de caché al 80% de `cacheMaxMb`. Ver Fase 2.5.E: ahora también
  llama `warmBatchPdfCache` por chunk.
- Canales: `deck:prewarm` (fire-and-forget, `scope: "explicit" | "visible"`),
  `deck:prewarmBatch`/`deck:cancelPrewarmBatch`, `deck:statuses`. Evento `prewarm-progress`.
- **Disparadores de prewarm:** explícito por `+`/drag&drop (desde `library-import.ts`), explícito
  por "agregar al programa" (`program.store.ts`), visible (debounced desde `media-browser.tsx`,
  ahora con techo — Fase 2.5.G).
- **UI**: `components/ui/loading-state.tsx` + `components/shared/deck-conversion-status.tsx`
  (comparte estado entre el monitor de PREVIEW y la columna de slides — ver Fase 2.5.D para el
  arreglo de cuándo se pisa la grilla). `ThumbTile` gana `progress?: number | null`. Botón
  "Preparar carpeta" en `PanelFooter`.

### Simplificaciones deliberadas frente al `PLAN.md` original (Fase 2, sin cambios)

1. **No hay `deck:prewarmFolder` que reciba un `path`** — `deck:prewarmBatch` recibe
   `assetIds: number[]` directamente, el renderer ya tiene la lista.
2. **Sin posición numérica de cola** en `DeckConversionStatus`.
3. **`pinDecks("program", ...)` no está conectado** — sólo `"projected"`.
4. **Claves i18n recortadas al uso real.**
5. **"Visible" era una aproximación** hasta la Fase 3 — ahora tiene un techo duro (Fase 2.5.G)
   en vez de mandar toda la vista.

### Archivos nuevos (F1 + F2, sin cambios respecto de la versión anterior)

```
src/main/services/library-import.ts
src/main/services/library-sweeper.ts
src/main/services/prewarm-service.ts
src/renderer/src/effects/library-sync.ts
src/renderer/src/components/ui/loading-state.tsx
src/renderer/src/components/shared/deck-conversion-status.tsx
src/renderer/src/components/pages/resources/panel-progress-row.tsx
src/renderer/src/components/pages/resources/prewarm-confirm-modal.tsx
src/renderer/src/lib/hooks/use-debounced-callback.ts
```

---

## Lo que falta — todo el plan está implementado

No queda código pendiente de las tres fases. Lo que falta es **verificación manual con
`npm run dev`**, que necesita la carpeta real de ~624 `.pps/.ppt` del usuario y una pantalla:

- Las cinco pruebas de Fase 2.5 que ya estaban pendientes (bucle de import muerto, go-live
  instantáneo de un deck prewarmeado con un batch corriendo, el `.pps`+`.mp3` hermano sonando la
  primera vez, cronometrar "Preparar carpeta" antes/después del batching, y que la proyección no
  se trabe con algo EN VIVO).
- Las seis de Fase 3, listadas arriba en su propia sección.

Fuera de alcance, anotado a propósito y no como promesa rota:

- **`SlideGrid` en decks largos** no usa `VirtualGrid` todavía — es su segundo consumidor
  natural, y el plan ya lo dejaba fuera.
- **`pinDecks("program", ...)` sigue sin conectar** — sólo `"projected"` (Fase 2).
- **`resolveLinkedAudio(path, dirCache)`** sigue sin caller que aproveche el `dirCache`.

## Hallazgos registrados con `/learn`

**Sesión del 2026-09-11 (Fase 3.5):**

- `.claude/knowledge/tile-height-uniformity-flex-min-height-and-grid-auto-rows.md` — **ampliada**
  con la mitad del ancho del mismo bug: un `<button>` es shrink-to-fit aunque sea `display:flex`,
  y medir una réplica del marcado en vez de la app es lo que dejó pasar el defecto.
- `.claude/knowledge/occluded-electron-window-has-no-rendering-lifecycle.md` — una ventana ocluida
  no corre frames, así que una UI que depende de rAF/`ResizeObserver` parece rota al sondearla.
- Graduó a `CLAUDE.md`: una primitiva que puede caer en una celda de grilla lleva `h-full` **y**
  `w-full`, y la altura de la que una grilla deriva offsets vive en `thumb-tile.geometry.ts`.

**Sesión del 2026-09-11 (Fase 3):**

- `.claude/knowledge/nativeimage-thumbnail-blocking-and-generic-icon.md` — las dos rutas de
  `nativeImage` no son intercambiables: una bloquea el hilo de main y la otra miente sobre lo
  que devolvió. Con la tabla de mediciones.
- `.claude/knowledge/tile-height-uniformity-flex-min-height-and-grid-auto-rows.md` — por qué
  `aspect-video` no alcanza para que todos los tiles midan igual, y por qué una grilla
  virtualizada tiene que fijar `gridAutoRows`.

**Sesión del 2026-09-10 (Fase 2.5):**

- `.claude/knowledge/list-channel-must-never-broadcast-its-own-refetch-signal.md` — el bucle de
  `listFolder`/`library-changed`.
- `.claude/knowledge/prewarm-lru-grace-and-linked-audio-full-file-read.md` — cierra los dos
  hallazgos que este mismo handoff dejaba pendientes de registrar desde la Fase 2 (el grace de
  24h del LRU + `pinDeck` sin callers, y la lectura completa del archivo en
  `resolveLinkedAudio`).
