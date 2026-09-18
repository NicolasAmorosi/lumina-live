# Optimización de importación masiva y pre-conversión de presentaciones

> Plan original aprobado por el usuario el 2026-09-10 (vía Plan Mode), copiado tal cual desde
> `~/.claude/plans/necesito-que-me-ayudes-shimmying-pumpkin.md` — es la referencia de diseño.
> El estado real de la implementación (qué se hizo, qué difiere y por qué, qué falta) está en
> `HANDOFF.md`, al lado de este archivo.

## Contexto

Dos problemas reportados por el usuario, que la investigación confirmó como el mismo
problema de fondo: **todo el trabajo pesado de la biblioteca de medios corre síncrono en el
main process**, bloqueando el event loop — es decir, bloqueando también la ventana de
proyección durante un culto.

1. **La conversión de un PPT empieza demasiado tarde.** Hoy `deck:ensure` se dispara sólo
   desde `deck-slides.tsx` (al entrar en preview) y desde `goLive()`. El operador paga la
   espera justo cuando la necesita.
2. **Agregar una carpeta con ~600 presentaciones congela la app.** Causa raíz medida:
   `media.repo.ts:84` llama `findLinkedAudio()` por cada `.ppt` importado, y
   `linked-audio.ts:133` **lee el archivo entero a memoria y lo convierte a string dos veces**
   (`utf16le` + `latin1`) para correrle un regex. Con 600 decks son decenas de GB procesados
   en el hilo del main. A eso se suman 600 `statSync`, ~1800 statements SQLite **sin
   transacción**, un `readdirSync` del mismo directorio por archivo, y un `sweep()` que hace
   `existsSync` sobre toda la biblioteca **en cada `library:list`**.
3. Y en el renderer: 600 tiles sin virtualización, cada video montando un `<video
   preload="metadata">` real (un pipeline de decodificación por tile) y cada tile `ppt`
   disparando su propio IPC `deck:get`.

**Resultado buscado:** importar una carpeta grande nunca bloquea la UI ni la proyección; las
presentaciones se convierten en segundo plano apenas entran al sistema, con progreso visible;
y lo que el operador abre en vivo siempre tiene prioridad sobre el trabajo de fondo.

### Decisiones ya tomadas con el usuario

- **Prewarm**: se pre-convierten (a) los PPT agregados explícitamente (`+`, drag&drop, agregar
  al programa), (b) los **visibles** en la grilla, y (c) una carpeta completa sólo por **botón
  manual** con aviso de duración, progreso y cancelación. Nunca 600 decks automáticos.
- **Miniaturas**: caché real servido por `worship://asset/<id>/thumb`.
- **Virtualización**: primitiva propia en `components/ui/`, sin dependencias nuevas.
- **Entrega en 3 fases verificables.**

### Dos conflictos de diseño, resueltos

- **La cola de prioridad vive en main, no en el renderer.** El renderer sólo declara intención
  (`deck:prewarm`); main decide el orden. Una cola paralela en el renderer duplicaría estado y
  mentiría, porque `goLive()` y el programa también encolan.
- **El chunking del import vive en main, no en el renderer.** Un solo `library:add` que cede
  el event loop entre lotes, en vez de N round-trips IPC de 20 paths.

---

## Fase 1 — Import no bloqueante (el 90% del alivio)

> Orden interno importante: **1.1 va primero**. Es el 95% de la ganancia y vuelve casi
> cosmético al resto.

### 1.1 Diferir la resolución de linked-audio fuera del import

`media.repo.ts:56-112` (`upsertFromPath`) deja de llamar `findLinkedAudio()`: inserta siempre
con `linkedAudioPath: null` y `linkedAudioResolvedVersion: 0`. El mecanismo lazy ya existe y
ya funciona — `MediaRepo.ensureLinkedAudio()` (`media.repo.ts:185-205`) re-resuelve cuando la
versión está desactualizada.

Se verificaron **todos** los consumidores y ninguno se rompe:

| Consumidor | Cubierto |
|---|---|
| `deck-service.ts:211` `toDeckDTO` | Sí — único constructor de `DeckDTO`, ya llama `ensureLinkedAudio` |
| `worship-protocol.ts:222` `linked-audio` | Sí — esa URL sólo se emite si el path ya se resolvió |
| `files.ts:33` `files:probe` | No aplica — resuelve sobre una ruta suelta. **Canal muerto: cero callers en el renderer; borrarlo** |
| `MediaAsset.linkedAudioPath` en el DTO | Sin consumidores en el renderer |

**Trampa a evitar (la encontró el análisis y es la que arruinaría la fase 2):** hoy la grilla
no paga `ensureLinkedAudio` porque `getDeck` sale antes por `findDeckByAsset() === null`.
Después del prewarm los 600 decks existen, y la primera pintada dispararía 600
`readFileSync` — el mismo asesino, un nivel más abajo. Dos mitigaciones, **ambas obligatorias**:

- `runConversion` ya termina en `toDeckDTO`, así que **el job de prewarm resuelve el
  linked-audio como parte de su trabajo**, gratis (ya tiene el archivo leído).
- `toDeckDTO(row, assetId, { resolve })`: `deck:get` pasa `resolve: false` (lee la fila tal
  cual), `deck:ensure` pasa `resolve: true`. Regla nueva a documentar: *el DTO de `deck:get`
  es "lo mejor que sabemos"; el de `deck:ensure` es autoritativo.*

`resolveLinkedAudio(path, dirCache?)` acepta un `Map` de directorio, con vida de **una sola
operación batch** (nunca global ni persistente: un `.mp3` copiado con la app abierta debe
verse).

### 1.2 Servicio de import chunkeado — `src/main/services/library-import.ts` (nuevo)

```ts
export type ImportProgress = { jobId: string; kind: AssetKind; total: number; done: number;
                               status: "running" | "done" | "canceled" };

/** Serializado a nivel proceso: dos imports nunca corren entrelazados. */
export function importPaths(paths: string[], kind: AssetKind,
                            opts?: { inLibrary?: boolean }): Promise<MediaAsset[]>;
```

Bucle: lotes de **100** → 1 `SELECT ... IN` + `statSync` del lote + **1 `db.transaction`** →
`await new Promise(r => setImmediate(r))`. ~2-3 ms de bloqueo por tick, por debajo de un frame.

**Restricción dura:** `db.transaction()` de better-sqlite3 tira si la función devuelve una
promesa, así que **frontera de transacción == frontera de lote**. No existe "una transacción
con yields adentro" — y tampoco se querría: mantendría el write-lock tomado a través de un
`await`.

Métodos nuevos en `MediaRepo`: `findByPathKeys(keys)` y `upsertBatch(...)`. Se elimina el
`SELECT` de relectura post-insert (`media.repo.ts:109`) usando `.returning().get()`.
De paso se arregla un bug latente: la rama de actualización (`media.repo.ts:79`) devuelve el
`sizeBytes` viejo.

**El contrato de `library:add` NO cambia** (sigue devolviendo `MediaAsset[]`): `library.store.ts`
ya ignora el valor de retorno, y con 1.1 aplicado 600 archivos son ~30 ms.

### 1.3 `library:listFolder` + `sweep()` fuera del camino caliente

- `listFolder` usa el mismo servicio con `inLibrary: false`, y **no emite UPDATE** si
  `pathKey` + `sizeBytes` + `mtimeMs` coinciden y no está `missing`. Una carpeta estable pasa
  de 600 UPDATE a cero.
- `library:list` (`library.ts:20-22`) pasa a ser un SELECT puro.
- `src/main/services/library-sweeper.ts` (nuevo): chunked de a 200 con yield, **un UPDATE por
  transición** en vez de uno por fila, debounce de 2 s. Corre al arranque (+2 s), tras
  mutaciones, en `browser-window-focus` (throttle 30 s) y cada 5 min sólo con ventana
  enfocada. Nada de `fs.watch` sobre carpetas de red.
- Se **emite por fin** `library-changed` (declarado en `contract.ts:146`, nunca emitido) y se
  agrega `library-import-progress` (throttle ≤ 4/s, sólo si `paths.length > 200`).

**Archivos:** `services/library-import.ts` y `services/library-sweeper.ts` (nuevos);
`db/repositories/media.repo.ts`; `ipc/handlers/library.ts`; `slides/linked-audio.ts`;
`slides/deck-service.ts` (`toDeckDTO`); `shared/ipc/contract.ts`; `stores/library.store.ts`.

### Riesgo de la fase 1

**`UNIQUE(path_key)`** (`schema.ts:47`): el chunking cede el loop, así que dos imports
concurrentes (drag&drop mientras corre un prewarm) dejarían obsoleto el `Map` de pathKeys →
`SQLITE_CONSTRAINT_UNIQUE` a mitad del import. Mitigación doble, no opcional: el lock de
proceso en `importPaths` **y** `INSERT ... ON CONFLICT(path_key) DO UPDATE` como cinturón.

---

## Fase 2 — Prewarm con prioridad y progreso

### 2.1 Dos colas en `deck-service.ts`

```ts
export type JobPriority = "interactive" | "background";
export type PrepareOptions = { force?: boolean; priority?: JobPriority; prewarmJobId?: string };
export function prepareDeck(assetId: number, opts?: PrepareOptions): Promise<DeckDTO>;
```

`interactiveQueue` y `backgroundQueue` separadas (`pump()` toma
`interactiveQueue.shift() ?? backgroundQueue.shift()`) — FIFO estable, O(1), sin comparadores
que alguien rompa después. Default `"interactive"`: el default seguro. Sólo 2 call-sites de
`prepareDeck` hoy, el cambio de firma es limpio.

**Promoción**: `inFlight` sigue siendo la única clave de dedupe; la prioridad es un campo
mutable. Un job background pedido como interactive se mueve de cola (o, si ya corre, queda
inmune a preemption).

**Preemption (suave, sólo de background):** sin ella, el operador que hace click durante el
culto espera detrás de un job de 60 s — justo el modo de falla que el prewarm debe evitar, no
causar. Reglas: sólo si el job corriendo es `background`, lleva **≥ 1.5 s** y no hubo
preemption en los últimos **10 s**; se re-encola al final de `backgroundQueue` con
`preemptCount + 1`; se descarta a los 2 intentos (anti-livelock). El `finally` debe hacer
`inFlight.delete()` **antes** de re-encolar.

> **Riesgo crítico**, documentado en
> `.claude/knowledge/soffice-shared-profile-race.md`: matar un `soffice` a mitad puede dejar
> el perfil bloqueado y hacer que **todas** las conversiones siguientes timeouteen. Guardas:
> la cancelación **no debe tocar `consecutiveTimeouts`** (hoy no lo hace — no romperlo al
> editar ese `catch`), y un setting `slides.preemptBackground` (default `true`) permite
> degradar a "sólo ordenamiento" sin un release.

### 2.2 Que el LRU siga funcionando (bloqueante para el botón de carpeta)

Hallazgo serio del análisis: `insertDeck` fija `lastUsedAt: now` y `evictIfOverCap` sólo
considera filas de más de 24 h (`deck-service.ts:560`). **600 decks prewarmeados serían
ineviccionables por un día** → `evictIfOverCap` se vuelve un no-op y el caché crece sin techo
por encima de `cacheMaxMb`. Tres arreglos:

1. **Backdate**: `runConversion` inserta con `lastUsedAt: Date.now() - 25h` cuando el job es
   `background`. Semánticamente exacto: "convertido por las dudas" ≠ "usado". Abrirlo de
   verdad llama `touchDeck` y lo promueve.
2. **`pinDecks(reason, ids)`**: generaliza el `pinDeck` actual (que pinnea uno solo y **no lo
   llama nadie** — hoy el deck en vivo es eviccionable, tapado por el grace de 24 h). Razones
   `"projected"` y `"program"`.
3. **Presupuesto**: el prewarm de carpeta se detiene al 80% de `cacheMaxMb` con
   `status: "cache-full"`. Sin esto se convierten 600 decks para desalojar 500.

### 2.3 Canales nuevos

```ts
"deck:prewarm":       { req: { assetIds: number[]; scope: "explicit" | "visible" }; res: void };
"deck:prewarmFolder": { req: { path: string }; res: { jobId: string; total: number } };
"deck:cancelPrewarm": { req: { jobId?: string }; res: void };
"deck:statuses":      { req: { assetIds: number[] }; res: Record<number, DeckStatus> };
// evento agregado, throttle ≤ 4/s
"prewarm-progress":   { jobId; label; total; done; skipped; failed; currentAssetId;
                        status: "running" | "done" | "canceled" | "cache-full" };
```

- `scope: "visible"` es un **set reemplazable**: al llegar uno nuevo se cancelan los jobs
  `visible` encolados-y-no-arrancados que ya no figuran. Sin esto, scrollear 600 tiles encola
  600 conversiones que nadie va a mirar.
- `deck:statuses` reemplaza los 600 `deck:get` de hoy por un round-trip por vista.
- El evento es **agregado** a propósito: reusar `deck-progress` (que es por `assetId`) metería
  600 entradas en `deck.store.byAssetId` y una tormenta de re-renders durante trabajo de fondo.

**Archivos:** `slides/deck-service.ts`; `slides/prewarm-service.ts` (nuevo);
`db/repositories/slides.repo.ts`; `ipc/handlers/slides.ts`; `shared/ipc/contract.ts`;
`shared/types/deck.ts`.

### 2.4 UI de los estados de carga (el pedido explícito de rediseño)

Primitiva nueva `components/ui/loading-state.tsx` — se justifica por **dos** usos con
superficies distintas: el monitor PREVIEW (sobre el stage negro, que obliga a `text-white/…`,
prohibido en `pages/**`) y la columna central de slides.

```ts
type LoadingStateProps = {
  action?: ReactNode; hint?: string; icon?: IconName; title: string;
  progress?: number | null | undefined;   // 0..1 | null=indeterminado | undefined=sin barra
  surface?: "stage" | "panel"; tone?: "busy" | "queued" | "failed"; className?: string;
};
```

`Record<Variant, string>` a nivel de módulo para `surface`/`tone`; usa `LinearLoader` (que hoy
no tiene ningún consumidor) y `ProgressBar`, ambos ya existentes.

`components/shared/deck-conversion-status.tsx` (nuevo) lee el store y cubre: preparando /
convirtiendo N de M / **en cola con posición** / fallido / **cancelable**. Reemplaza el bloque
ad-hoc de `deck-slides.tsx:113-138` y se agrega a `preview-monitor.tsx`, que hoy no muestra
**nada** durante la conversión (cae al placeholder genérico). Que ambos digan lo mismo con el
mismo layout es la regla "los monitores no le mienten al operador" aplicada al estado de carga.

Progreso en el tile: `ThumbTile` gana `progress?: number | null` (la geometría se encapsula en
la primitiva — pasarla por `overlay` obligaría a escribir `rounded-none` desde `pages/**`).

Claves i18n nuevas en `messages/es.ts`: `deck.cancel/canceled/queued/queuedHint/queuedShort`,
`library.importing/importDone/importCanceled`, y el bloque `prewarm.*` (incluye
`warnBody: "Puede tardar unos {minutes} minutos…"`, estimado con una media móvil de las
últimas 10 conversiones y fallback de 8 s/deck).

El botón **"Preparar carpeta"** va en el `PanelFooter` sólo con `kind === "ppt"`, abre un
`Modal` + `Callout tone="warning"` con el aviso, y mientras corre muestra una fila de progreso
cancelable (`panel-progress-row.tsx`, compartida con el progreso de import).

---

## Fase 3 — Virtualización y miniaturas

### 3.1 `components/ui/virtual-grid.tsx` (nuevo)

**No tiene scroller propio**: renderiza spacer + ventana y escucha el scroll de su ancestro.
`PanelBody` (`components/shared/panel.tsx:33`) ya es `overflow-y-auto` **y** es el drop target
de archivos del SO — un scroll anidado daría doble barra y dejaría el `onDrop` fuera del área
útil. Así el drag&drop existente no se toca: todo burbujea.

Geometría equivalente al `repeat(auto-fill, minmax(7rem,1fr))` actual:
`columns = floor((width + gap) / (minItemWidth + gap))`. `ResizeObserver` para el ancho;
handler de scroll `passive` que sólo guarda `scrollTop` y recalcula en un `rAF`, con `setState`
**sólo si cambió la fila** — cero re-renders scrolleando dentro de una misma fila.

`itemHeight` acepta función `(columnWidth) => number` porque el tile es `aspect-video` + label;
`THUMB_TILE_LABEL_PX` se exporta desde `thumb-tile.tsx` para que el número no se duplique.

Accesibilidad — **va junta con la virtualización o la navegación por teclado empeora**:
`role="list"`/`listitem` con `aria-setsize`/`aria-posinset` (el AT tiene que saber que hay más
de lo montado), **roving tabindex** (hoy tabular 600 tiles son 600 Tabs), flechas +
`scrollToIndex`, y `pinnedIndex` para que el item enfocado se renderice siempre y el foco no
se caiga al `<body>` al scrollear.

Segundo consumidor natural, fuera de alcance por ahora: `SlideGrid` en decks largos.

### 3.2 Caché de miniaturas — `src/main/media/thumbnail-service.ts` (nuevo)

- **Clave por `size + mtime`, no por hash.** Hashear un MP4 de 4 GB para dibujar un tile de
  120 px es absurdo, y size+mtime es exactamente la identidad que `slide_decks` ya considera
  confiable en su cache-hit más barato (`deck-service.ts:288-290`).
  `MEDIA_THUMB_VERSION` en `shared/constants.ts`, mismo patrón que `SLIDES_CONVERTER_VERSION`.
- Archivos en `userData/thumb-cache/<ab>/<key>.jpg` (sharding por 2 chars), **sin tabla en la
  DB**: el nombre es el índice. Escritura atómica `.tmp-<uuid>` + `renameSync`, misma
  disciplina que el commit del deck cache.
- `image` → `nativeImage.createFromPath().resize({width:320}).toJPEG(80)` (cross-platform).
  `video` → `await nativeImage.createThumbnailFromPath()` — **sólo macOS/Windows**; chequear
  `process.platform` *antes* de llamar, no confiar en el reject. `audio` → icono.
  `ppt` → **no pasa por acá**: `worship://deck/<id>/1/thumb` ya existe y es autoritativo.
- Concurrencia: `Map<key, Promise>` in-flight (30 tiles pidiendo lo mismo comparten una
  generación) + semáforo global de 4 con yield entre generaciones, porque
  `nativeImage.resize()` es **trabajo nativo síncrono en el hilo del main**. Escape hatch si
  igual trabea: hacer el resize en la ventana offscreen que ya existe (`slides/rasterizer.ts`).

Se sirve on-demand desde `worship-protocol.ts` (`case "asset"`, sub-ruta `/thumb`), sin canal
IPC previo: con la grilla virtualizada, el `src` del `<img>` ya *es* la señal de "esto se
necesita ahora". 404 cuando no hay miniatura, para que el fallback lo pinte el renderer con
sus tokens de tema.

**Cache-buster obligatorio** — aplica de lleno
`.claude/knowledge/stable-capability-url-needs-a-cache-buster-to-refresh.md`: la respuesta va
`immutable`, así que una URL estable dejaría la miniatura vieja pegada un año.

```ts
// src/shared/urls.ts — `version` NO es opcional a propósito: omitirlo debe ser error de compilación.
export function assetThumbUrl(mediaAssetId: number, version: string): string;
```

Hueco a tapar: `MediaAsset` no expone `mtimeMs` (la columna existe, el DTO no la mapea) — hay
que agregarlo. **No usar `updatedAt`**: cambia por escrituras no relacionadas y no cambia si el
archivo se modifica por fuera.

### 3.3 `asset-tile.tsx` se simplifica

Desaparecen el `<video preload="metadata">` (probablemente la mayor ganancia de esta fase: hoy
es un pipeline de decodificación por tile visible) y `useDeckThumb` con sus 600 IPC — **el hook
se borra en el mismo commit**, para no dejar dos fuentes de verdad.

El rango visible alimenta el prewarm con triple throttle: `VirtualGrid` notifica por fila (no
por píxel), `useDebouncedCallback(300ms)` nuevo en `lib/hooks/`, y `scope: "visible"` reemplaza
el set entero en main.

---

## Verificación

Barra mínima del repo tras **cada fase**:
```bash
npm run typecheck && npm run lint && npm run db:smoke
```

Pruebas manuales con `npm run dev`, por fase:

**F1** — Carpeta real de ~600 PPT como carpeta vinculada:
- La UI responde durante todo el import (mover el mouse sobre la grilla, cambiar de pestaña).
- **Con algo EN VIVO en el proyector**, importar y confirmar que la proyección no se traba.
- Reabrir la pestaña: el segundo `listFolder` no escribe nada (verificable en el log).
- **Regresión crítica de 1.1:** un `.pps` binario legacy con su `.mp3` hermano, abierto por
  primera vez, **tiene que sonar**. Es el punto exacto donde se escondería la regresión.

**F2** — `slides:smoke` sigue pasando; con un prewarm de carpeta corriendo, abrir otro deck y
verificar que arranca en ≤ ~2 s (preemption). Tras varias preemptions seguidas, confirmar que
las conversiones **siguen funcionando** (perfil de soffice sano). Cancelar el lote y que no
queden jobs vivos. Verificar que el tamaño de `slides-cache` respeta `cacheMaxMb`.

**F3** — Scrollear 600 tiles a 60 fps; sólo ~30 nodos en el DOM (DevTools). Navegación por
teclado: un solo Tab entra a la grilla, flechas se mueven, el foco no se pierde al scrollear.
Drag de un tile al schedule sigue funcionando. Reemplazar un archivo de imagen en disco y
confirmar que la miniatura se actualiza (cache-buster).

## Cierre

Al terminar, evaluar con `/learn` dos candidatos a hallazgo durable — ambos cumplen los tres
criterios (no derivables, costaron encontrarlos, condicionan un área entera):

- `resolveLinkedAudio` leía el deck **entero** a memoria en el camino de import, y diferirlo
  simplemente **muda** la tormenta a `deck:get` salvo que `toDeckDTO` deje de resolver.
- El grace de 24 h de `evictIfOverCap` combinado con `insertDeck(lastUsedAt: now)` **desactiva
  el LRU** ante cualquier conversión masiva.
