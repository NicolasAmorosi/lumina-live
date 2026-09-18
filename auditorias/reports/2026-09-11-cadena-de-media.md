# Auditoría — cadena de procesamiento de media, de punta a punta

**Fecha:** 2026-09-11 (auditoría + arreglos bloqueantes/altos) · 2026-09-11, segunda sesión
(los 7 medios de la lista de prioridad — §4) · 2026-09-13, tercera sesión (los 33 defectos,
fugas y estados mal manejados que quedaban — §4.1) · 2026-09-13, cuarta sesión (`N3` arreglado y
**las 21 pruebas manuales pendientes corridas contra la app real** — §4.2) · 2026-09-13, quinta
sesión (11 de los 13 de rendimiento, y **el pase automático perdido** — §4.3 y §11)
**Alcance:** todo el pipeline de media (import → conversión → caché → serving → proyección), los
dos paneles de la primera columna (`SchedulePanel`, `ResourcePanel`) y el sistema que los sostiene
— ciclo de vida de ventanas, IPC, base de datos, stores y efectos.
**Base:** `src/` completo, 18.268 líneas, 176 archivos. Rama `main`, commit `4ec5ff3`.
**Motivación:** cerrar el plan `plans/2026-09-10-import-y-prewarm-optimizacion/` buscando lo que
ese plan no miraba: bugs latentes, fugas de memoria, trabajo desperdiciado y, sobre todo, puertas
abiertas a un crash bloqueante **durante un culto**.

---

## 1. Resumen ejecutivo

Se encontraron **3 defectos bloqueantes**, **18 de severidad alta** y **53 medios o menores**.
Los tres bloqueantes y los 18 altos quedaron arreglados en la primera sesión; de los medios,
**los 7 de la lista de prioridad (§10) se arreglaron en la segunda** — están en §4 — y **los 33
que eran defectos, fugas o estados mal manejados, en la tercera** (§4.1), junto con dos nuevos que
aparecieron por el camino (`N1`, `N2`).

La **cuarta sesión cerró las dos cosas que quedaban** (§4.2):

- **`N3`**, el único defecto abierto: la cuenta de "presentaciones sin convertir" preguntaba por
  propiedad de la fila mientras el caché responde por contenido, y decía **555 pendientes donde el
  trabajo real era 0**, sin poder bajar nunca a cero porque preparar una carpeta se lo robaba a la
  otra. `media_assets` ahora guarda el hash de contenido y el estado se pregunta por ahí:
  **680 → 1235 `ready`, 0 pendientes, 0 assets apuntando a un deck ajeno**, con un backfill de
  1,98 s una sola vez. La solución barata por `(tamaño, mtime)` se descartó **por medición**: 34
  colisiones reales en esta misma biblioteca.
- **Las 21 pruebas manuales** que tres sesiones venían arrastrando: corridas contra la app y la
  biblioteca reales (§9). **18 pasan, `A9` a medias, 2 escenarios no reproducibles en macOS.** Cero
  regresiones.

**No queda ningún defecto abierto.** Los 13 hallazgos de rendimiento que restaban se redujeron a
**2 en la quinta sesión** (§4.3), y esos dos quedan abiertos por una razón explícita: `M23` no es
verificable sin una máquina Linux y `M42` no es un ajuste de rendimiento sino una feature con
decisión de UI.

La quinta sesión además respondió una pregunta que trajo el usuario y que no estaba en la
auditoría: **por qué un bloque entero del himnario no tiene pase automático.** No era ni de los
archivos ni de nuestro parser — es el filtro de exportación a `.pptx` de LibreOffice, que sólo
escribe `advTm` cuando la diapositiva tiene un efecto visual de transición. **222 de 1226 archivos
afectados, arreglados, con los 122 decks ya convertidos rellenados en 42 ms sin reconvertir nada.**
El análisis completo es **§11**.

Los tres bloqueantes, en una línea cada uno:

1. **Cancelar la conversión de una presentación la volvía inutilizable hasta reiniciar la app.**
   `cancel()` sacaba el job de la cola sin resolver su promesa ni borrarlo del mapa de deduplicación,
   así que todo intento posterior de abrir ese PPT recibía una promesa muerta — y, como el atajo de
   cache-hit está guardado por ese mismo mapa, ni siquiera podía responder desde el caché.
2. **Reabrir la ventana de proyección dejaba a main creyendo que no había proyector.** El listener
   `closed` de la ventana vieja anulaba la referencia a la nueva, que seguía viva en pantalla: a
   partir de ahí ningún cambio de diapositiva llegaba al proyector y el botón de cerrar no cerraba
   nada.
3. **Un archivo de Biblia importado podía ejecutar código en la ventana de control.** El buscador
   pintaba el resultado de FTS5 con `dangerouslySetInnerHTML`, y ese resultado contiene el texto
   del versículo tal cual viene del JSON que el operador importó. El renderer expone el puente IPC
   genérico, así que el script resultante tenía acceso a **todos** los canales de la app.

El patrón de fondo, y lo que más conviene recordar: **el proceso main hace casi todo su trabajo de
archivos de forma síncrona**, y el hilo que bloquea es el mismo que atiende a la ventana de
proyección. Un `existsSync` sobre un pendrive desconectado, un `readdirSync` sobre un share de red
o un `readFileSync` de un `.pptx` de 200 MB no son lentitudes: son congelamientos de la proyección.

La segunda causa transversal: **no había ninguna red de seguridad**. Cero Error Boundaries, cero
`unhandledrejection` en el renderer y cero `unhandledRejection` en main, sobre un estilo de código
que llama IPC como `void api.algo()` en unas cuarenta partes. Cualquier fallo de disco, de base de
datos o de LibreOffice desaparecía sin dejar rastro, o dejaba la ventana en blanco.

### Barra mínima tras los arreglos

Verde después de las cuatro sesiones:

```
npm run typecheck   ✅
npm run lint        ✅ (5 warnings preexistentes de react-refresh)
npm run db:smoke    ✅ 14/14, con dos aserciones nuevas (FTS5 en el paso 5, N3 en el 14)
npm run build       ✅
```

En la tercera sesión la app se ejecutó por primera vez; en la cuarta se **manejó**: las 21 pruebas
manuales que faltaban se corrieron por CDP contra la biblioteca real (§9), y todo lo que agregaron
a los datos del usuario se quitó después.

---

## 2. Método

Lectura completa de `src/main`, `src/preload`, `src/shared` y `src/renderer`, con dos barridos
paralelos independientes (proceso main / renderer) y verificación manual de cada afirmación fuerte
contra el código antes de registrarla. Se contrastó además contra modos de falla conocidos y
documentados de Electron, Chromium y Node:

- fugas de listeners y de `BrowserWindow` en Electron, y el coste de `webContents.send` frecuente
  ([electron#27039](https://github.com/electron/electron/issues/27039),
  [guía de memoria en Electron](https://www.mindfulchase.com/explore/troubleshooting-tips/frameworks-and-libraries/diagnosing-and-fixing-memory-leaks-in-electron-applications.html));
- el deadlock clásico de un `stdio: "pipe"` que nadie consume
  ([docs de child_process](https://nodejs.org/api/child_process.html));
- descriptores de archivo y streams en `protocol.handle`
  ([nodejs#1834](https://github.com/nodejs/node/issues/1834),
  [electron#21018](https://github.com/electron/electron/issues/21018));
- el requisito de identidad estable de `getSnapshot` en `useSyncExternalStore`
  ([zustand#1936](https://github.com/pmndrs/zustand/discussions/1936),
  [react.dev](https://react.dev/reference/react/useSyncExternalStore));
- fugas de nodos `<video>` y del caché de imágenes decodificadas en Chromium
  ([crbug 969049](https://issues.chromium.org/issues/41462045)).

**No se ejecutó la app.** Todo lo que requiere la biblioteca real del usuario y una pantalla está
en la sección 9 como verificación manual pendiente.

---

## 3. Hallazgos bloqueantes y altos — todos arreglados

| id | Sev | Dónde | Qué pasaba | Arreglo |
|---|---|---|---|---|
| **C1** | 🔴 Crítico | `slides/deck-service.ts:521` | `cancel()` sacaba un job **encolado** de la cola sin `inFlight.delete` ni `reject`. La promesa de `deck:ensure` nunca se resolvía, y el job zombi en `inFlight` hacía que todo `prepareDeck(assetId)` posterior devolviera esa misma promesa muerta — saltándose incluso el cache-hit, que está guardado por `if (!inFlight.has(assetId))`. **Ese PPT no se podía volver a proyectar en toda la sesión.** Alcanzable desde el botón "Cancelar" y desde el borrado forzado de un asset | `settleCanceledJob()`: borra de `inFlight`, libera el directorio de lote y rechaza con `CANCELED`, sólo cuando el job estaba encolado (uno corriendo ya se settlea por `pump`). Misma disciplina en `cancelAll()`, `setVisiblePrewarm()` y `cancelBackgroundJobs()` |
| **C2** | 🔴 Crítico | `ipc/handlers/projection.ts:29` | `projection:open` cierra la ventana existente (asíncrono) y registra la nueva de inmediato. El `closed` de la vieja hacía `setWindow(null)` **sin comprobar identidad**, dejando `projectionState.window` en `null` con la ventana nueva en pantalla: ningún `projection:show` volvía a llegar al proyector y `projection:close` no cerraba nada | `projectionState.clearWindowIf(win)` — compara contra el campo interno (no contra `getWindow()`, que ya devuelve `null` para una ventana destruida y por lo tanto nunca coincidiría) |
| **C3** | 🔴 Crítico | `pages/resources/bible-browser.tsx:231` + `db/repositories/bible.repo.ts:95` | El snippet de FTS5 venía envuelto en `<mark>` y se pintaba con `dangerouslySetInnerHTML`. Un snippet **contiene el texto del versículo**, y el operador puede importar cualquier JSON como versión bíblica (`bible:import`): un versículo con `<img src=x onerror=…>` ejecutaba script en la ventana de control, que expone `window.worship.invoke` genérico y con él todos los canales IPC | El snippet dejó de ser markup: FTS5 delimita con `char(1)`/`char(2)`, `parseSnippet()` (en `shared/types/bible.ts`) lo parte en segmentos y la primitiva nueva `HighlightedText` los emite como elementos React. **Cero `dangerouslySetInnerHTML` en el repo.** Cubierto por una aserción nueva en `db:smoke` |
| **A1** | 🟠 Alto | `slides/deck-service.ts:138,764` | `deck-progress` se emitía **por página rasterizada, también para trabajo de fondo**: un lote de 600 decks de ~30 diapositivas son ~18.000 mensajes IPC a *todas* las ventanas, cada uno provocando un `set()` en el store del renderer que clona un `Record` con una entrada por deck visto. Trabajo cuadrático, durante un culto, por un número que nadie lee diapositiva a diapositiva. Es exactamente lo que el evento agregado `prewarm-progress` se creó para evitar, y había quedado sin mitigar | `emitPageProgress()` calla el progreso por página de los jobs `background`; las transiciones de estado (converting/ready/failed) se siguen emitiendo para todos. Además `progressByAsset` ya no conserva entradas terminales |
| **A2** | 🟠 Alto | `slides/deck-service.ts:242` | Ningún camino de cancelación llamaba `releaseBatchDirFor`, así que `BatchDirRef.remaining` nunca llegaba a cero: el directorio temporal del chunk (hasta 20 PDFs, cientos de MB) **no se borraba hasta el próximo arranque**, y los mapas de precomputados retenían entradas toda la sesión | `settleCanceledJob` lo libera en los cuatro caminos |
| **A3** | 🟠 Alto | `slides/deck-service.ts:988` + `slides/libreoffice.ts:311` | `warmBatchPdfCache` invocaba `soffice` en lote **sin `signal`**, y `sofficeChain` serializa todas las invocaciones contra el perfil compartido. La guarda existente sólo evita *empezar* el lote: una vez arrancado, un `deck:ensure` interactivo esperaba detrás hasta **30 minutos** (`convertTimeoutForBatch`). El modo de falla que la preemption existe para prevenir, reintroducido un nivel más abajo | `batchWarmController`: el lote tiene su propio `AbortController`, `tryPreemptForInteractive` lo aborta en cuanto entra trabajo interactivo, y `cancelBackgroundJobs`/`cancelAll` también. Se respeta `slides.preemptBackground` como interruptor de emergencia, igual que la preemption por job. El batch ya era best-effort ante interrupción, así que conserva los archivos que alcanzó a escribir |
| **A4** | 🟠 Alto | `slides/libreoffice.ts:329` | `stdio: ["ignore","pipe","pipe"]` con **stdout nunca consumido**: cuando el hijo escribe más que el buffer del pipe (~64 KB) se **bloquea** hasta que el timeout lo mata. `--convert-to` imprime una línea por archivo convertido, así que un lote suficientemente grande llega solo. `stderr` además se acumulaba en un string sin techo durante hasta media hora | `stdout: "ignore"` (nadie lo lee: las salidas se descubren listando `--outdir`) y `stderr` acotado a 8 KB |
| **A5** | 🟠 Alto | `slides/rasterizer.ts:63,172` | Dos fugas de `BrowserWindow`: si `loadURL`/`loadFile` rechazaba, la ventana quedaba viva, sin referencia y sin destruir; y tras `render-process-gone` el handler hacía `window = null` pero nunca destruía la ventana muerta. Con crashes repetidos (OOM en un PDF grande) se acumulan procesos | `try/catch` con `destroy()` alrededor de la carga, `destroy()` en el handler de crash, y limpieza del token `pendingPdfs` si la ventana no se puede crear |
| **A6** | 🟠 Alto | `index.ts:108` | (a) La ventana recreada en `activate` no pasaba por `wireMinimizeRestoreSync`: tras cerrarla y reabrirla en macOS, minimizar ya no bajaba la proyección y cerrar el control dejaba el proyector encendido. (b) `BrowserWindow.getAllWindows()` **cuenta la ventana oculta del rasterizador**, así que un clic en el dock tras una conversión reciente no reabría nada, y en Windows/Linux `window-all-closed` no disparaba → app fantasma | `openControlWindow()` como único punto de entrada (cablea todo), `userFacingWindows()` excluye el rasterizador vía `isRasterizerWindow`, y el `closed` de la ventana de control decide el quit contra ese conteo |
| **A7** | 🟠 Alto | `index.ts:129` | `uncaughtException` mostraba un `showErrorBox` **modal por cada ocurrencia** y no cerraba la app: un error repetitivo dejaba una pared de diálogos infranqueable. No existía handler de `unhandledRejection`, así que todo el estilo `void algoAsync()` de main podía fallar en silencio | Un solo diálogo por ejecución (el resto va a `crash.log` y a consola), el log envuelto en `try` (un handler de crash que revienta se lleva el proceso sin dejar rastro) y `unhandledRejection` conectado |
| **A8** | 🟠 Alto | `db/repositories/history.repo.ts:64` | `prune()` **no lo llamaba nadie** pese al comentario "called once at startup": `projection_history` crecía sin techo, una fila por cambio de output con el output serializado. Y la implementación traía **todos** los ids a memoria y borraba con `IN (...)` — con la tabla grande, superaba el límite de variables ligadas de SQLite, o sea que fallaba justo cuando hacía falta | Se llama diferido al arranque (junto al prune de miniaturas) y se reescribió como un `DELETE … WHERE id NOT IN (SELECT … ORDER BY id DESC LIMIT MAX_ROWS)` |
| **A9** | 🟠 Alto | `ipc/handlers/library.ts:64`, `services/library-import.ts:87`, `db/repositories/media.repo.ts:328` | Tres bloqueos síncronos sobre rutas que en esta app son rutinariamente un pendrive o un share de red: `readdirSync` de la carpeta vinculada, `statSync` por archivo importado y `existsSync` por fila en `sweep()`. El `sweep` corre solo al arranque, en cada foco de ventana y cada 5 minutos. Congelar el main es congelar **la proyección** | Los tres pasaron a `fs.promises` (`readdir`, `stat` por chunk con `Promise.all`, `access` en lotes de 200 con yield) |
| **A10** | 🟠 Alto | `ipc/handlers/projection.ts:10` + `slides/deck-service.ts:1050` | `setCurrentProgramId` y `pinDecks("program", …)` **no tenían ningún caller** (verificado por grep): cada fila del historial se escribía con `programId: null`, y los decks del programa cargado **no estaban protegidos del desalojo LRU**, al contrario de lo que promete el comentario de `pinDecks` — enmascarado sólo por la gracia de 24 h de `evictIfOverCap` | `adoptProgram()` en `programs:load` y `programs:save` conecta ambos |
| **B1** | 🟠 Alto | `stores/program.store.ts:102` | Los ids provisionales salían de `items.length` (`-(length+1)`) y por lo tanto **colisionaban**: agregar A(-1) y B(-2), borrar A, agregar C → C recibe `-2`, duplicado de B. Con `key={item.id}` duplicada, React reutiliza el DOM equivocado, la etiqueta asíncrona se pega a la fila que no es y el `data-index` que lee el drop deja de corresponder | Contador monótono de módulo (`nextProvisionalId`) |
| **B2** | 🟠 Alto | `stores/program.store.ts:110,142,151,160` | `activeIndex` no se remapeaba en `removeAt`/`moveUp`/`moveDown`/`reorder`. Tras reordenar, el riel "está en el proyector AHORA" marcaba **otra** fila — un monitor mintiéndole al operador, que es la única cosa que el tratamiento on-air no puede hacer | `shiftForInsert`/`shiftForRemoval`/`shiftForMove` aplicados a los dos cursores en las cinco mutaciones |
| **B3** | 🟠 Alto | `pages/resources/ResourcePanel.tsx:40` | Sólo `setActiveTab` limpia `library.selectedId`, y no se llamaba al pasar a la pestaña Biblia. Como `removeSelected()` prioriza la biblioteca sobre el programa, **Delete/Backspace borraba un asset de la biblioteca mientras el operador miraba la Biblia** — sin confirmación, si el asset no estaba en un programa guardado | `select(null)` al entrar a "bible" |
| **B4** | 🟠 Alto | `stores/deck.store.ts` | `byAssetId` no tenía evicción: el prewarm reporta sobre cada deck de la carpeta y cada entrada guarda un `DeckDTO` completo (una URL por diapositiva), así que un lote de 600 dejaba 600 entradas vivas por el resto de la sesión, recopiadas por el spread en cada push posterior | `applyProgress` sólo crea entrada para lo que está `converting`, y al llegar a `ready` sin DTO la borra — salvo que haya un `ensure` en vuelo (main empuja `ready` un instante antes de que la llamada resuelva, y borrarla en esa ventana haría parpadear "Preparando…" sobre un deck ya terminado) |
| **B5** | 🟠 Alto | `stores/projection.store.ts:138` | `mediaStatus` se indexa por `audio:asset:<id>:<epoch>` y el epoch sube en **cada** go-live: mandar el mismo audio diez veces creaba diez claves y **nada las borraba nunca** — ni `removeTrack`, ni `clear`. Un ensayo largo dejaba cientos de entradas muertas, clonadas otra vez en cada `setMediaStatus` (~4/s por elemento sonando) | `pruneMediaStatus(liveTrackIds)`, llamada desde el único lugar que conoce la lista completa de pistas vivas (`projection-sync.ts`) |
| **B6** | 🟠 Alto | `media-browser.tsx:141`, `remove-asset-confirm.tsx:23`, `bible-browser.tsx:92` | Tres lecturas sin guarda de secuencia — y no hay `AbortController` posible, porque `invoke` no es cancelable. Cambiar de carpeta rápido dejaba `deckStatuses` describiendo **otra** carpeta; el diálogo de borrado podía listar los programas del asset anterior mientras confirma el borrado forzado del actual; y la búsqueda bíblica no tenía debounce, así que ganaba la última respuesta en llegar, no la del texto tipeado | Guarda de secuencia monótona en las tres, más `debounce` de 200 ms en la búsqueda y limpieza sincrónica de la lista al cerrar el diálogo |
| **B7** | 🟠 Alto | `stores/library.store.ts` | Ningún estado de carga ni de error. Mientras `library:listFolder` estaba en vuelo, la grilla pintaba **"no hay recursos"** sobre una carpeta con 600 archivos; y un rechazo era una unhandled rejection silenciosa que dejaba la vista anterior sin decir nada | `viewStatus` por vista (`loading`/`error`) + guarda de secuencia, consumido por `MediaBrowser` con un `LoadingState` y un reintento. De paso, `forgetFolder` libera el listado de una carpeta desvinculada (`folderAssets` tampoco tenía evicción) |
| **B8** | 🟠 Alto | global | **Cero Error Boundaries y cero handler de `unhandledrejection`** sobre ~40 `void fn()` sin `.catch`. Un throw en render dejaba la ventana en blanco a mitad de un culto, sin nada que hacer; un rechazo de IPC simplemente no ocurría | `ErrorBoundary` alrededor de `AppShell` (con reintentar/recargar, y el `ToastHost` deliberadamente fuera para que siga visible) e `installGlobalErrorHandlers()` para `unhandledrejection` + `error`, con colapso de repeticiones |

---

## 4. Hallazgos medios arreglados — segunda sesión

Los siete de la lista de prioridad de §10, en ese orden. Las decisiones de producto que había
abiertas (§9 y el handoff) las cerró el usuario antes de implementar: el aviso de error va al
monitor (nunca al proyector) y **no** cambia la proyección por su cuenta, el preview también
avisa, y el prewarm tras un import se acota con un tope duro sin diálogos nuevos.

| id | Dónde | Qué se hizo | Verificación |
|---|---|---|---|
| **M40** | `shared/types/projection.ts`, `ipc/handlers/projection.ts`, `ProjectionApp.tsx`, `output-view.tsx`, `live-monitor.tsx`, `preview-monitor.tsx`, `live-media-panel.tsx`, `media-track-row.tsx`, `projection.store.ts`, `projection-sync.ts` | `onError` en el `<video>`, los `<audio>` y los `<img>` del proyector → canal nuevo `projection:reportMediaError` → evento `media-error` → `mediaErrors` en el store. El operador lo ve en tres lugares: una banda roja sobre el escenario del monitor LIVE, un toast con el nombre del archivo, y la fila de la pista marcada en el panel de medios. **El proyector nunca pinta el aviso** (`mode === "live"` no recibe `errorLabel`): reporta, y la ventana de control es la que avisa. La proyección no se cambia sola — la decisión sigue siendo del operador | typecheck + lint + build. Falta la prueba manual: borrar un archivo con la app abierta y mandarlo EN VIVO |
| **M3** | `slides/zip-reader.ts` (**nuevo**), `pptx-metadata.ts`, `linked-audio.ts` | Se dejó de leer el `.pptx` entero para sacarle unas pocas entradas XML. El lector nuevo ubica el EOCD (con zip64), parsea el directorio central y lee **solo los rangos de bytes pedidos**, con una ventana única cuando las entradas están juntas (lo normal en un `.pptx`). Sigue siendo síncrono a propósito: las lecturas son de KB, así que ni `readPresentationMeta` ni `MediaRepo.ensureLinkedAudio` ni nada por encima tuvo que volverse `async` | **622 checks diferenciales** contra `unzipSync`, byte a byte: zips deflate/stored/zip64/con comentario, 4 `.pptx` reales y ~150 `.pps` binarios (que ambos deben rechazar). `slides:smoke` OK sobre un `.pptx` de 22,9 MB y sobre un `.pps` legacy con audio vinculado. Medido: 4,5 ms → 1,0 ms (metadata) y 4,0 ms → 0,2 ms (rels) en el deck de 22,9 MB, **con caché de disco caliente** — en frío, sobre un pendrive, la diferencia es de otro orden |
| **M1** | `deck-service.ts` `hashFile` | Pasó a `fs/promises`: las lecturas van al thread pool y el `hash.update` queda acotado al chunk de 1 MB en vez de al tamaño del archivo. Único caller (`runConversion`) ya era `async` | typecheck; ejercitado por `slides:smoke` |
| **M18** | `libreoffice.ts`, `deck-service.ts` | Dos cosas. (a) `killTree(child, immediate)`: en el camino de salida manda SIGTERM **y SIGKILL en la misma llamada**, sin `setTimeout` — un timer armado en `before-quit` no llega a correr nunca, que es la razón por la que el SIGKILL de respaldo no existía en la práctica. En Windows, `execFileSync` en vez de `execFile` por lo mismo. (b) `reapOrphanedSoffice()` al arrancar: mata lo que haya quedado huérfano de un crash, filtrando por **nuestro propio** `-env:UserInstallation`, así que una copia de LibreOffice que el usuario tenga abierta no se toca. No se hace en Windows (no hay equivalente sin PowerShell/WMI) y queda documentado en el código | Probado contra procesos reales: dos `soffice` vivos, uno con nuestro perfil y otro con un perfil ajeno (ambos con `(` y `[` en la ruta, para ejercitar el escapado) — se mató solo el nuestro |
| **M13** | `shared/constants.ts`, `services/library-import.ts` | `PREWARM_EXPLICIT_MAX = 20`: un import explícito convierte automáticamente los primeros 20 y nada más. El resto queda para "Preparar carpeta", que avisa y es cancelable — y cualquier deck sin convertir convierte igual al previsualizarlo. El alcance es solo el import (`library-import.ts`); el scope `"program"`, que pasa por la misma función, **no** se acota: los decks del orden del culto tienen que estar listos | typecheck |
| **M25** | `projection.store.ts` `selectOutputMemo` | Se cambió el `JSON.stringify` del output completo por una comparación por referencia de los 8 campos que `selectOutput` realmente lee. `mediaStatus` no es uno de ellos — y es el que más escribe, ~4 Hz por elemento sonando — así que esas notificaciones ahora cortan en O(1) sin construir ni serializar nada. De paso desaparece el riesgo de thrash del slot único: dos estados que difieren solo en `mediaStatus` producen la misma tupla y por lo tanto el mismo objeto | typecheck + build |
| **M26** | `SchedulePanel.tsx`, `bible-browser.tsx` | Las dos suscripciones sin selector que quedaban pasaron a un selector por campo (las identidades de las acciones de Zustand son estables, así que no cuesta nada). `projection-section.tsx` ya usaba selectores — el hallazgo original lo listaba de más | typecheck + lint |

Lo que **no** se tocó de la lista: `M2` (`dirSize`), que sigue haciendo un `statSync` por archivo tras
cada conversión.

---

## 4.1 Hallazgos arreglados — tercera sesión (2026-09-13)

El alcance de esta sesión lo eligió el usuario: **defectos, fugas y estados mal manejados sí;
refactors de rendimiento no**. Quedaron arreglados 31 hallazgos completos y 2 parciales, más **dos
nuevos**: `N1`, que apareció al arreglar `M9`, y `N2`, que apareció al **correr la app** para las
pruebas manuales 1–3. Correr la app destapó además `N3` (§5.2), que quedó abierto a pedido del
usuario y **se arregló en la cuarta sesión** (§4.2). Los 13 restantes son todos de rendimiento y
están listados al final de esta sección.

### Proceso main

| Hallazgo | Qué cambió |
|---|---|
| **M7** | El stream de `worship://` tiene `stream.on("error")` (una unidad desconectada a mitad de un video ya no se traga el error) y está atado a `request.signal`: un pedido abortado destruye el descriptor en vez de depender de que Chromium cancele el web stream. El `catch` del handler dejó de devolver un 500 mudo |
| **M9** | Reconvertir a la fuerza el deck que está EN VIVO le borraba sus filas y sus URLs pasaban a 404 bajo el proyector. Ahora se rechaza con un aviso al operador. **El guard vive en la ventana de control** (`lib/actions/deck.ts`), no en main: es el único lugar que sabe qué deck está en vivo **debajo de NEGRO/LOGO** — main solo ve el último `ProjectionOutput`, donde un overlay sobre un deck es indistinguible de no tener deck |
| **N1** (nuevo) | Del mismo diagnóstico: `projection:show` hacía `pinDecks("projected", [])` en cuanto el output no era una diapositiva — **incluido NEGRO y LOGO**. Tres minutos de NEGRO sobre un deck, una pasada de desalojo en el medio, y las diapositivas ya no estaban al destapar. Los overlays ya no sueltan el pin; lo suelta el próximo output que de verdad reemplaza el contenido |
| **M12** | `statusesByAsset` chunkea el `IN (...)` de a 500 como `media.repo.ts`. Sin esto, una carpeta de miles de decks no era lenta: era una query que SQLite rechaza |
| **M19** ✅ parcial | Allowlist de emisores (`ipc/trusted-senders.ts`): las tres ventanas propias se registran al crearse y cualquier otro `webContents` recibe `UNTRUSTED_SENDER`. **La validación de payload por canal no se hizo** — son ~100 canales y es un refactor, no un arreglo. No defiende de un XSS en la propia ventana (mismo `webContents`); de eso defiende la regla de no construir markup con texto ajeno |
| **M20** | `resetSofficeProfile` recrea el directorio que borra: la próxima conversión es la de esta ejecución, no la del próximo arranque |
| **M21** | `locateSoffice` deduplica llamadas concurrentes. Sin LibreOffice instalado, dos `deck:environment` en paralelo pagaban el barrido completo de candidatos dos veces, con 10 s de timeout por sonda. Un `force` nunca se suma a un barrido en vuelo — forzar existe justamente porque cambiaron las entradas |
| **M22** | Los cuatro puntos del servicio de miniaturas: el semáforo transfiere el slot en vez de decrementar-y-conceder (ya no se puede exceder); una generación encolada se cancela si su tile dejó de ser visible (atada al mismo `request.signal`, que es lo que acota la cola de espera); el set de fallos desaloja el más viejo en vez de vaciarse entero; y el prune tiene tope de tamaño además de edad (`MEDIA_THUMB_MAX_BYTES`) |
| **M24** | Borrar el programa abierto dejaba `currentProgramId` apuntando a una fila inexistente — todo el historial posterior mal atribuido y sus decks pinneados para siempre. Ahora se libera en `programs:delete`, y "Nuevo programa" tiene su propio canal (`programs:releaseCurrent`), que antes no existía |

### Proyección y reproducción

| Hallazgo | Qué cambió |
|---|---|
| **M28** | La capa saliente de una transición se soltaba solo con `animationend`. Si la animación no corre — y una ventana ocluida de Electron no tiene ciclo de render, así que no corre — `animation-fill-mode: both` deja la capa entrante clavada en opacidad 0 con la vieja pintando debajo: **el proyector deja de cambiar**. Ahora hay un temporizador de respaldo de `durationMs + 400 ms` |
| **M27** | Las precargas de diapositivas vecinas se cancelan (`src = ""`, que es lo único que aborta de verdad una descarga de imagen) en cuanto la posición actual deja de quererlas. La diapositiva que se está mostrando encabeza la lista justo para no cancelarse a sí misma |
| **M41** | El `ref` de cada pista de audio del proyector era una closure nueva por render, así que React lo desmontaba y remontaba (`delete` + `set` en el mapa) en cada uno — y un `media-command` que cayera en esa ventana no encontraba elemento. Ahora recibe el mapa y el callback es estable |
| **M34** | `deck-autoplay` declara su estado de módulo como lo que es (hay un solo proyector) y lo hace explícito con `activeInstance`: solo el setup más nuevo puede resetearlo, y el teardown ya no deja `seededEpoch` atrás — que era lo que hacía que un deck reabierto arrancara la música desde 0 |

### Stores, hooks y utilidades

| Hallazgo | Qué cambió |
|---|---|
| **M35** | `settings.store.update` mergea **antes** del await. Dos cambios concurrentes (agregar una carpeta a `video` y quitar otra de `image`) mergeaban cada uno contra el estado previo al otro y el segundo en resolver descartaba al primero en silencio. Si la escritura falla, se relee de main en vez de intentar deshacer |
| **M44** | Un contador de generación por asset: cancelar (o superar con un `force`) una conversión retira su petición, así que la promesa en vuelo ya no escribe su resultado encima del `stale` que main empujó. El `finally` también chequea identidad — antes borraba la entrada de `pending` de la petición que la había reemplazado |
| **M36** | El caché de `use-media-asset` tiene cota y `catch`: un rechazo dejaba el id sin cachear y cada render reintentaba el mismo pedido fallido |
| **M33** | Los timers de los toasts se cancelan al descartarlos y hay un tope de 4 simultáneos. Los que llevan `action` siguen sin autoexpirar, que es deliberado |
| **M32** / **M45** / **M37** | El timer de typeahead de `Select` se limpia al desmontar; `bible-browser` trunca `itemRefs` al largo de la lista; y `use-ipc-event.ts` (código muerto con una trampa) se borró |

### Paneles

| Hallazgo | Qué cambió |
|---|---|
| **M43** | Las pestañas de Recursos se montan en la primera visita y ya no se desmontan: se ocultan con `visibility` (primitivas `TabPanels`/`TabPanel`). `display:none` y desmontar destruyen la caja de layout y con ella el scroll — que es justamente lo que se quería conservar. Una pestaña oculta **no** pide prewarm de su rango visible: eso lo corta el prop `active` |
| **M29** / **M30** | Lo que la virtualización tiraba en cada scroll ahora vive en registros de módulo acotados (`createBoundedSet`): las URLs que dieron 404 y las que ya decodificaron. Un `.gif` sin miniatura dejó de pedir su propio 404 en cada pasada, y un tile ya visto no vuelve a mostrar el esqueleto. `ThumbTile` además sabe que un `src` que falló terminó, en vez de depender de que alguien de afuera le cambie el `src` |
| **M31** | `scrollbar-gutter: stable` en `PanelBody` (inerte donde las barras son overlay, que es donde el problema no existe); el listener de scroll se monta una vez y llama al `recomputeWindow` más nuevo por ref; y la aserción de geometría de dev mide una vez por ancho de columna en vez de forzar layout en cada cruce de fila, para siempre |
| **M38** / **M39** / **L4** | El mensaje "ya no hay nada visible" se manda sin debounce y desde su propio efecto (antes lo armaba un cleanup que corría **después** del cleanup del hook de debounce, así que nunca se entregaba y dejaba un timer huérfano); "Preparar carpeta" manda exactamente los assets que contó el modal, no todos; y `library:list` ya no corre en vista de carpeta |
| **M47** | El botón de guardar se deshabilita mientras la escritura está en vuelo: un doble clic mandaba dos `programs:save` |
| **L1** / **L2** / **L3** | El indicador de drop ya no parpadea entre filas (`dragleave` hacia un hijo se ignora) ni re-renderiza en cada `dragover`; agregar archivos al programa tiene `try/catch` con aviso; y el arrastre del programa usa `hideDragGhost` como la lista de programas |
| **L5** / **L6** / **M46** ✅ parcial | Desvincular una carpeta pide confirmación; las pestañas tienen `role="tabpanel"`, `aria-controls`/`aria-labelledby` y el foco sigue al tabindex móvil; y la columna izquierda tiene un piso de altura defensivo (el panel redimensionable de `M46` es una feature, no un defecto, y quedó fuera) |
| **N2** (nuevo) | **Encontrado corriendo la app** (prueba manual 1). Cancelar una conversión dejaba el panel central diciendo "La presentación no tiene diapositivas" — acusando al archivo de algo que el operador acababa de elegir hacer, y sin camino de vuelta salvo seleccionar otra cosa y volver. Causa: la store mapea `CANCELED` a `stale` con `deck: null`, `deck-slides.tsx` sólo enrutaba `converting`/`failed` a `DeckConversionStatus`, y ese componente tampoco tenía rama para `stale`. Ahora dice "Conversión cancelada" y ofrece "Reintentar". Sólo se volvió alcanzable cuando el arreglo de `C1` hizo que cancelar de verdad settleara la promesa, así que nadie lo había visto nunca |

### Fuera de alcance por decisión explícita

Los 13 de rendimiento: `M2` (`dirSize`), `M4`, `M5` (caché de settings), `M6` (queries por imagen
servida), `M8`, `M10`, `M11`, `M14` (arranque síncrono), `M15`, `M16`, `M17`, `M23` (miniaturas en
Linux) y `M42`.

Y, aparte de esos, **`N3` queda abierto siendo un defecto**, no una optimización: el usuario lo vio
en uso ("el botón está en todos los archivos y la cuenta siempre está mal") y decidió que se
documente ahora y se arregle después. Está en §5.2, con las tres formas de resolverlo.

### Verificación

`typecheck` + `lint` (5 warnings preexistentes) + `db:smoke` 13/13 + `build` + `slides:smoke` sobre
un `.pps` real del usuario.

Y —por primera vez en las tres sesiones— **la app se ejecutó y se manejó de punta a punta**. Primero
un arranque instrumentado (registró su ventana en la allowlist y aceptó `settings:get`,
`bible:versions`, `bible:books`, `displays:list` y `projection:show` sin un solo rechazo). Después,
**las pruebas manuales 1, 2 y 3 de §9 se corrieron sobre la biblioteca real** conduciendo la app por
el DevTools Protocol: las tres pasan, y la primera destapó `N2`. El detalle de cómo se condujo está
en el handoff §4.2; lo que sigue sin ejercitarse son las pruebas 4–24.

---

## 4.2 Cuarta sesión (2026-09-13) — `N3` arreglado y las pruebas manuales corridas

Dos cosas: el único defecto que quedaba abierto, y el hueco que tres sesiones venían arrastrando
— **21 pruebas manuales que nadie había ejecutado nunca**.

### `N3` — el estado de conversión se pregunta por contenido

**Elección del usuario entre las tres opciones de §5.2: la tercera** (`content_hash` en
`media_assets`), **con backfill en background al arrancar**. La opción barata quedó descartada por
evidencia, no por gusto: medida sobre la biblioteca real, empatar por `(source_size_bytes,
source_mtime_ms)` resuelve los 1235 assets con cero pendientes — parece correcta — pero **34 pares
`(tamaño, mtime)` corresponden a contenidos distintos**, porque `Himnario Nuevo Cantado/035.pps` y
`Himnario Nuevo Instrumental/035.pps` se copiaron juntos. La cuenta saldría bien; la miniatura del
tile (`worship://deck/<deckId>/1/thumb`) y el pin de desalojo de `adoptProgram` apuntarían al deck
equivocado. Cambiar un número mentiroso por una imagen mentirosa no es un arreglo.

| Qué | Dónde |
|---|---|
| `media_assets` gana `content_hash` + el sello `(content_hash_size, content_hash_mtime_ms)` que lo valida, con índice | `db/schema.ts`, `drizzle/0007_media_content_hash.sql` |
| `statusesByAsset` hace JOIN por hash; la propiedad de la fila queda **sólo** como respaldo para un asset que el backfill todavía no selló, para que una grilla dibujada mientras tanto no regrese a "nada está convertido" | `db/repositories/slides.repo.ts` |
| `runConversion` guarda el digest apenas lo calcula — ya lo necesitaba, así que es gratis | `slides/deck-service.ts` |
| `backfillContentHashes()`: barrido asíncrono 2 s después del arranque sobre todo `ppt` sin sello válido, chunks de 25 con yield, `deck-statuses-changed` throttleado a 750 ms. Idempotente | `media/content-hash.ts` (nuevo), `main/index.ts` |
| `hashFile` se mudó de `deck-service.ts` a `media/content-hash.ts`: el digest ya no es sólo cosa del pipeline de slides | `media/content-hash.ts` |
| `tryCacheHit` gana un segundo nivel: si el asset tiene sello válido, resuelve el deck por identidad **sin releer el archivo**. Antes, un duplicado caía siempre a `runConversion` y releía 1,5 MB para recalcular un hash que el asset ya tenía | `slides/deck-service.ts` |
| `relinkDeck` ahora mueve también `source_size_bytes`/`source_mtime_ms`. Sin eso la fila conservaba el sello de la copia anterior y el camino rápido de `tryCacheHit` — el que cuesta un solo `statSync` — no volvía a acertar nunca para el nuevo dueño | `db/repositories/slides.repo.ts` |
| `deck-statuses-changed`: evento nuevo. Deliberadamente **no** es `library-changed` — la biblioteca no cambió, sólo lo que main puede responder — y el renderer lo enchufa al `readyEpoch` que ya existía | `shared/ipc/contract.ts`, `stores/deck.store.ts`, `effects/projection-sync.ts` |
| `db:smoke` pasa de 13 a 14 checks: el nuevo arma dos archivos byte a byte idénticos, un solo deck, y exige que **los dos** reporten `ready` — antes y después de un `relinkDeck` — y que un sello viejo deje de empatar | `scripts/db-smoke.ts` |

**Medido, no supuesto.** Primero sobre una **copia** de la base real, y después en la app:

| | Antes | Después |
|---|---|---|
| Assets `ppt` que reportan `ready` | 680 de 1235 | **1235 de 1235** |
| Falsos pendientes | **555** | **0** |
| Assets apuntando a un deck de otro contenido | — | **0** |
| Costo del backfill | — | 1235 archivos, 1,78 GB, **1,98 s**, una sola vez |
| Consulta de estado para 1235 assets | — | 4 ms |

En la app: las dos carpetas del himnario dan **0 pendientes** y **las 1227 tiles tienen
miniatura** (antes la mitad mostraba el ícono genérico), y el botón "Preparar carpeta" directamente
no aparece porque no hay trabajo. Con 30 presentaciones nuevas importadas a propósito, la cuenta
marca exactamente las **10** que de verdad faltan.

### Las 21 pruebas manuales — corridas

Ver §9. Resumen: **18 pasan, 1 pasa parcial (`A9`), 2 no son reproducibles en esta plataforma.**
Cero regresiones.

## 4.3 Quinta sesión (2026-09-13) — los 13 de rendimiento y el auto-avance perdido

Dos frentes: cerrar la lista de rendimiento que quedaba abierta, y un síntoma nuevo que trajo el
usuario — **"las presentaciones 51 a 63 de las dos carpetas no tienen pase automático aunque
técnicamente deberían"**. El segundo resultó ser bastante más grande que el rango reportado y tiene
su propia sección: **§11**.

### Rendimiento — 11 de los 13 arreglados

| id | Qué se hizo | Dónde |
|---|---|---|
| M5 ✅ | `SettingsRepo` cachea el mapa entero en memoria. `getAll()` devuelve una copia (`structuredClone`) porque dos claves son objetos; `get()` —el camino caliente— devuelve por referencia. `setMany` es el único punto de mutación y actualiza el caché en la misma llamada | `db/repositories/settings.repo.ts` |
| M6 ✅ | `getSlideImagePath` pasa de **2 queries a 1 JOIN**, con `sqlite.prepare` cacheado. Igual `getAudioPath`. En `media.repo`, `getById`/`getPathById`/`linkedAudioPathById` dejan de hacer `SELECT *` y piden sólo las columnas que usan | `db/repositories/slides.repo.ts`, `media.repo.ts` |
| M2 ✅ | `dirSize()` **eliminado**. `RasterPage` ahora lleva también `thumbBytes`, así que `bytesOnDisk` es la suma de lo que cada escritor ya reportó | `slides/rasterizer.ts`, `slides/deck-service.ts` |
| M4 ✅ | El parámetro `dirCache` que ningún caller pasaba se reemplazó por un caché de listados con **TTL de 2 s** y tope de 32 carpetas, dentro del módulo. La TTL es mucho más corta que el tiempo que tarda una persona en copiar un `.mp3` y hacer clic, así que un archivo nuevo se sigue encontrando | `slides/linked-audio.ts` |
| M8 ✅ | `insertDeck` usa una sentencia preparada por tabla y la re-ejecuta, en vez de que Drizzle **construya y compile** un INSERT por diapositiva | `db/repositories/slides.repo.ts` |
| M10 ✅ | `lruCandidates` pide dos columnas y lleva `LIMIT`; `evictIfOverCap` pagina de a 64. Antes traía todas las filas bajo el corte, completas, para usar casi siempre las primeras | `db/repositories/slides.repo.ts`, `slides/deck-service.ts` |
| M11 ✅ | `cacheStats()` cuenta con `COUNT(*)` en vez de materializar `allDeckDirs()` para leer `.length`, y el lote usa un `cacheUsage()` nuevo que sólo pide los dos números que mira. Deliberadamente **no** se bajó la frecuencia del chequeo: abaratarlo conserva la granularidad de cancelación | `slides/deck-service.ts`, `services/prewarm-service.ts` |
| M14 ✅ parcial | `backupBeforeMigrate` sólo copia **cuando hay migraciones pendientes** (lo decide leyendo `meta/_journal.json` contra `__drizzle_migrations`). El seed de la Biblia hashea el `Buffer` y sólo decodifica a UTF-8 si el digest cambió | `db/migrate.ts`, `db/seed/seed-bible.ts`, `main/index.ts` |
| M15 ✅ | `initSlidesSubsystem` cede un turno del event loop **antes** de su primer trabajo síncrono. `void` sólo difiere a partir del primer `await`, que estaba después de todo el barrido | `slides/deck-service.ts` |
| M16 ✅ | La migración de datos legacy se parte en dos: los settings (dos claves, siguen en el arranque) y la biblioteca, ahora diferida y a través de `importPaths` — transacciones por chunk con yield, en vez de un `statSync`+insert por archivo sin transacción | `services/migrate-legacy-data.ts`, `main/index.ts` |
| M17 ✅ | `broadcast()` mantiene un **registro** de ventanas en vez de usar `getAllWindows()`. La ventana de control se registra al crearse; el proyector y el rasterizador dejan de recibir eventos a los que nunca se suscribieron — `media-status` **nace** en el proyector, iba a main y volvía al proyector | `services/broadcast.ts`, `windows/control-window.ts` |
| — ✅ | El ruido de `AbortError` en el log: `streamFile` distingue una cancelación esperada (`AbortError`, `ABORT_ERR`, `ERR_STREAM_PREMATURE_CLOSE`) de un error de lectura real. Chromium cancela en cada seek de video y en cada cambio de escena, así que el error que importa —un pendrive desenchufado a mitad de culto— estaba enterrado en ruido idéntico | `protocol/worship-protocol.ts` |

**Un defecto real apareció dentro de M14.** `backupBeforeMigrate` corría en **todos** los arranques y
conservaba los últimos 3. Como las migraciones corren una sola vez, tres arranques normales después
de migrar consumían los tres cupos con copias post-migración: **la única copia que la función existe
para guardar —la de antes de migrar— ya había sido rotada**. Se veía en la carpeta real: las 3
copias eran del mismo día, del mismo tamaño, todas posteriores a la última migración. Gatear el
backup por "¿hay algo pendiente?" arregla el rendimiento y el defecto con el mismo cambio.

### Medido

Números de esta máquina (macOS, SSD), no estimaciones:

| | Antes | Después |
|---|---|---|
| 400 resoluciones de `worship://deck/<id>/<n>` | 3,6 ms | **0,5 ms** (×7) |
| `dirSize` tras convertir un deck de 400 diapositivas (~800 archivos) | ~41 ms de main bloqueado | **0** |
| `bytesOnDisk` calculado por suma vs. suma real de archivos | — | **exacto al byte** (2 decks verificados) |
| `copyFileSync` de la DB en cada arranque | 10,2 MB, 4,3 ms, **y rotaba el backup bueno** | no se hace |
| Decodificar UTF-8 de `rv1960.json` en cada arranque | 4,0 MB | no se hace (sólo el hash del Buffer) |

**Hay que decirlo con honestidad: M14 y M15 eran bastante menos caros de lo que la auditoría
estimaba en esta máquina.** El bloque entero de arranque síncrono mide ~12 ms con un SSD, y el
`readdirSync` del caché de slides (683 entradas) 0,5 ms. Los arreglos quedan porque escalan con la
biblioteca y porque uno de ellos destapó un defecto — no porque hubiera segundos que recuperar.

### Los 2 que quedan abiertos, y por qué

- **`M23` (miniaturas en Linux).** El arreglo es hacer el resize en la ventana offscreen que ya
  existe: un canal nuevo, un tipo de trabajo nuevo en el rasterizador. Escribirlo a ciegas para una
  plataforma que no se puede probar acá, y para un síntoma que en macOS/Windows es nulo, es agregar
  superficie sin poder verificarla.
- **`M42` (paginar `library:list` / acotar `listFolder`).** Medido en la biblioteca real:
  `library:list("ppt")` devuelve **6 filas** (el resto de las 1235 son de carpeta vinculada y no
  pasan por ahí), y `listFolder` ya va por `importPaths`, que trocea con yields. Lo que queda es
  hipotético (una carpeta de 50.000 archivos) y el arreglo honesto es **paginar de verdad**: un
  tope silencioso le mentiría al operador sobre cuántos archivos tiene la carpeta, que es
  exactamente lo que la regla de "los monitores nunca mienten" prohíbe. Es una feature con decisión
  de UI, no un ajuste de rendimiento.

`M19` (validación de payload por canal) sigue donde estaba: es un refactor de ~100 canales con un
esquema compartido, no un arreglo.

## 5. Hallazgos medios y menores — el catálogo completo

Ninguno de estos rompe un culto por sí solo. Están ordenados por área; la columna **Coste** dice
qué se gana al arreglarlo. Los marcados **✅** ya están arreglados (segunda y tercera sesión) y su
entrada queda acá como el diagnóstico original — el qué se hizo está en §4 y §4.1.

### 5.1 Trabajo síncrono en el hilo de main (el patrón dominante)

| id | Dónde | Qué | Coste |
|---|---|---|---|
| M1 ✅ | `deck-service.ts:83` `hashFile` | Lee el archivo **entero** y le calcula SHA-256, síncrono, por conversión. Un `.pps` de 60 MB son cientos de ms de event loop bloqueado — con la proyección detrás | Alto si se convierte durante un culto. Fix: hash por stream con yields, o `crypto` en un `utilityProcess` |
| M2 ✅ | `deck-service.ts:98` `dirSize` | Walk recursivo con `statSync` por archivo, tras **cada** conversión: un deck de 400 diapositivas son ~800 `statSync` | Medio. Fix: acumular los bytes que ya devuelve `rasterizePdf` por página |
| M3 ✅ | `pptx-metadata.ts:128`, `linked-audio.ts:190` | `readFileSync` del `.pptx` **completo** antes de descomprimir sólo unas entradas. La rama binaria legacy se arregló en la Fase 2.5 (escaneo en chunks); la rama OOXML quedó igual | Alto con decks grandes: un `.pptx` de 200 MB son 200 MB de allocation síncrona. Fix: leer el directorio central del zip por offsets, o mover el parseo fuera de main |
| M4 ✅ | `linked-audio.ts:33` | `resolveLinkedAudio(path, dirCache)` acepta un caché de directorio que **ningún caller usa**: una carpeta de 600 decks relista el mismo directorio 600 veces | Bajo-medio. Fix: pasar un `Map` por operación de lote (ya documentado como corte de alcance en el handoff de Fase 2.5) |
| M14 ✅ parcial | `index.ts:36` `initDatabase` | 100 % síncrono antes de crear la ventana: `copyFileSync` de la DB entera (backup), migraciones, seed de la Biblia con `readFileSync` + `JSON.parse` + SHA-256 **calculado antes de comparar** | Medio: es todo tiempo de pantalla en blanco al arrancar. Fix: comparar `size+mtime` antes de hashear; diferir el seed |
| M15 ✅ | `index.ts:93` | `void initSlidesSubsystem()` corre síncrono hasta su primer `await`: 3 `mkdirSync`, `sweepCache()` (rm recursivo + readdir + borrado de decks a medio hacer) y `evictIfOverCap()`. El comentario dice "Non-blocking" y no lo es para ese prefijo | Medio. Fix: un `setImmediate` antes del sweep |
| M16 ✅ | `services/migrate-legacy-data.ts` | `readFileSync` + `upsertFromPath` por entrada, **sin transacción ni chunking** | Bajo (corre una sola vez). Fix: reusar `importPaths` |

### 5.2 Base de datos

| id | Dónde | Qué | Coste |
|---|---|---|---|
| **N3** ✅ | `slides.repo.ts` `statusesByAsset` / `relinkDeck`, `media-browser.tsx` `pendingDeckAssetIds` | **La UI pregunta por propiedad y el caché responde por contenido.** El caché de decks es content-addressed (`contentHash + renderWidth + imageFormat`), pero `deck:statuses` contesta "¿está convertido?" buscando una fila de `slide_decks` **cuyo `media_asset_id` sea ese asset** — y `relinkDeck` **mueve** ese campo, así que una fila tiene un solo dueño a la vez. Dos archivos byte a byte idénticos comparten una fila: el último que se abrió la posee y **el otro figura pendiente para siempre**. Peor: preparar una carpeta repuntea las filas hacia sus assets, y la cuenta de la otra sube en la misma medida — el contador nunca baja a cero, oscila. Medido en la biblioteca real: **1235 assets, 680 hashes distintos, 555 falsos pendientes, 0 pendientes reales** (el usuario tiene cada himnario duplicado: `Cantado/001.pps` y `Himnario Nuevo Cantado/001.pps` son el mismo archivo). **Arreglado en la cuarta sesión** con la opción 3 — ver §4.2 | **Alto.** No es sólo un número. (a) "Preparar carpeta" ofrece convertir 555 presentaciones y estimar minutos de trabajo que no existe. (b) **El tile muestra el ícono genérico en vez de su primera diapositiva** para cada asset que no es dueño — en esta biblioteca, la mitad de la grilla se ve sin convertir aunque esté toda convertida. (c) El mismo `statusesByAsset` alimenta `adoptProgram`, así que **el deck de un ítem del culto no se pinea contra el desalojo** si su asset perdió la fila — la misma clase de agujero que `N1`. Fix: ver abajo |
| M5 ✅ | `settings.repo.ts:34` | Sin caché en memoria: cada `get(key)` es un SELECT + `JSON.parse`. `resolveRenderTarget()` hace tres, y se lo llama en cada `tryCacheHit` — es decir, por asset en cada prewarm | Medio. Fix: cachear en memoria e invalidar en `setMany` |
| M6 ✅ | `worship-protocol.ts:222` → `slides.repo.ts:324` | `getSlideImagePath` hace **2 queries** por cada imagen servida; `getPathById`/`linkedAudioPathById` hacen `SELECT *` para devolver una columna. Sin prepared statements cacheados (Drizzle reconstruye cada sentencia) | Medio: una tira de miniaturas de 400 diapositivas son 800 queries. Fix: un JOIN + `sqlite.prepare` fuera del camino caliente |
| M8 ✅ | `slides.repo.ts:186` | `insertDeck` inserta fila por fila dentro de la transacción: 400 INSERT construidos por Drizzle para un deck de 400 | Bajo-medio. Fix: `values([...])` multi-fila o `sqlite.prepare` + bucle |
| M9 ✅ | `slides.repo.ts:170` | `insertDeck` borra la fila del deck con la misma identidad (`contentHash+width+format`). Forzar una reconversión del deck **que está en el proyector** le saca sus filas bajo los pies: sus URLs `worship://deck/<id>/…` pasan a 404 y una diapositiva aún no cargada sale negra | Medio, escenario poco común. Fix: no reemplazar una identidad pinneada, o repuntar las URLs |
| M10 ✅ | `slides.repo.ts:298` | `lruCandidates` hace `SELECT *` sin `LIMIT` de todas las filas bajo el corte | Bajo. Fix: `LIMIT` + columnas mínimas |
| M11 ✅ | `prewarm-service.ts:78` | `cacheOverBudget()` corre **por cada asset** del lote y llama `cacheStats()`, que hace `allDeckDirs()` (trae todos los directorios para usar sólo `.length`) + `totalBytes()` + un `settings.get` | Bajo. Fix: chequear por chunk, no por asset |
| M12 ✅ | `slides.repo.ts:103` | `statusesByAsset` usa `IN (...)` **sin chunkear** (`media.repo.ts` sí chunkea a 500): con miles de ids supera el límite de variables ligadas | Bajo hoy, alto el día que una carpeta tenga miles. Fix: chunkear igual que `media.repo` |
| M24 ✅ | `programs.ts` | `programs:delete` no limpia `currentProgramId` si borra el programa actual; "nuevo programa" tampoco lo resetea (no hay canal) | Bajo: atribuye mal filas del historial |

### 5.3 Protocolo `worship://` y miniaturas

| id | Dónde | Qué | Coste |
|---|---|---|---|
| M7 ✅ | `worship-protocol.ts:92,264` | El stream no tiene handler de error ni se ata a `request.signal`: el cierre del descriptor depende enteramente de que Chromium cancele el web stream, y un error de lectura a mitad (unidad desconectada durante un video) no se loguea. El `catch` del handler devuelve 500 **mudo** | Medio: conviene confirmar con `lsof` que un video con muchos seeks no acumula descriptores. Fix: `stream.on("error")` + log, y `signal` → `destroy()` |
| M22 ✅ | `media/thumbnail-service.ts` | Cuatro detalles: el semáforo puede excederse en 1 (el waiter incrementa en un microtask posterior al `release`); `waiting[]` no tiene cota ni cancelación (si un tile dejó de ser visible, su miniatura se genera igual); `failed` se vacía **entero** al llegar a 2000 en vez de desalojar; y el prune sólo mira edad, no tamaño total | Bajo. Es el único módulo del pipeline enteramente asíncrono y el mejor del repo en ese sentido |
| M23 | `thumbnail-service.ts:114` | En Linux no hay thumbnailer del SO, así que **todas** las miniaturas de imagen caen al camino síncrono (`createFromPath`+`resize`), medido en 782 ms por 10 PNG 4K | Alto **en Linux**, nulo en macOS/Windows. Fix: hacer el resize en la ventana offscreen que ya existe |
| M42 | `library.ts:26,61` | `library:list` devuelve la tabla completa del kind sin paginar, y `listFolder` no acota cuántas entradas mapea (una carpeta de 50.000 archivos se procesa entera) | Bajo-medio |

### 5.4 Ciclo de vida y procesos

| id | Dónde | Qué | Coste |
|---|---|---|---|
| M17 ✅ | `services/broadcast.ts:13` | Emite a **todas** las ventanas, incluidas la de proyección y la del rasterizador, que no escuchan ninguno de esos canales. `media-status` sale de la proyección, va a main y vuelve a la proyección | Bajo-medio (ya muy aliviado por A1). Fix: dirigir por ventana |
| M18 ✅ | `libreoffice.ts:280` | El SIGKILL de respaldo es un `setTimeout(5000).unref()` que **nunca corre en `before-quit`** (el proceso sale antes). Y los hijos son `detached`, así que un crash de main deja `soffice.bin` huérfano | Medio: un `soffice` colgado bloquea las conversiones del próximo arranque por el perfil compartido. Fix: SIGKILL sincrónico en el camino de quit |
| M19 ✅ parcial | `ipc/register.ts:17` | Cero validación runtime del payload y cero verificación del sender: el contrato es sólo de tipos, y el preload expone `invoke(channel, req)` genérico. Cualquier ventana puede invocar cualquier canal con cualquier cosa | Bajo hoy (todas las ventanas son propias y sandboxed) — pero es lo que le da alcance real a un XSS como C3. Fix: validar en el borde los canales que escriben |
| M20 ✅ | `libreoffice.ts:637` | `resetSofficeProfile` borra el directorio y no lo recrea (sólo se recrea en el arranque siguiente) | Bajo |
| M21 ✅ | `libreoffice.ts:184` | `locateSoffice` no deduplica llamadas concurrentes: dos `deck:environment` en paralelo recorren los candidatos dos veces, con `probeVersion` a 10 s de timeout cada uno | Bajo |
| M13 ✅ | `services/library-import.ts:126` | Tras un import explícito, `prewarmExplicit(results)` encola **todos** los assets. Agregar 600 presentaciones con `+` o arrastrándolas encola 600 conversiones automáticas sin confirmación — justo lo que la decisión de diseño "nunca 600 decks automáticos" quería evitar (el botón "Preparar carpeta" sí avisa) | Medio. Fix: acotar como el prewarm visible, o pedir confirmación por encima de N |

### 5.5 Panel del programa (columna 1, arriba)

| id | Dónde | Qué | Coste |
|---|---|---|---|
| M26 ✅ | `SchedulePanel.tsx:23` | `useProgramStore()` **sin selector**: cualquier escritura del store (seleccionar, marcar activo, editar metadatos) re-renderiza el panel y, como `ScheduleRow` no está memoizado, todas las filas. Mismo patrón en `bible-browser.tsx:55` y `projection-section.tsx:24` | Bajo-medio con decenas de ítems. Fix: selectores finos |
| M47 ✅ | `TopBar.tsx:40` | `saveCurrentProgram()` se dispara con `void`: sin spinner, sin deshabilitar el botón, sin `catch`. Un doble clic manda dos `programs:save` | Bajo-medio |
| L1 ✅ | `SchedulePanel.tsx:72,121` | `setDragOverIndex` en cada evento `dragover` (decenas por segundo) y `onDragLeave` que no distingue hijos, así que el indicador parpadea al cruzar entre filas | Menor |
| L2 ✅ | `SchedulePanel.tsx:39,77` | `addPaths`/`handleDrop` sin `try/catch`, y entre `await`s los índices se calculan contra un array que pudo cambiar | Menor (ya cubierto en parte por B8) |
| L3 ✅ | `lib/dnd.ts:23` | `hideDragGhost` existe y el schedule no lo usa (arrastra con el fantasma translúcido del navegador, a diferencia de `ProgramsModal`) | Cosmético |

#### N3 — las tres formas de arreglarlo, y cuál se eligió

Se eligió la **3**, y la **1 quedó descartada por medición** (ver §4.2): resuelve los 1235 con cero
pendientes, pero **34 pares `(tamaño, mtime)` de esta misma biblioteca corresponden a contenidos
distintos**, así que el tile pintaría la miniatura del deck equivocado y `adoptProgram` pinearía el
deck equivocado contra el desalojo.

1. **Barato y parcial** — que `statusesByAsset` empate además por `(source_size_bytes, source_mtime_ms)`, que ya están en la fila y son la misma identidad que `tryCacheHit` usa para su atajo más rápido. Una query indexada más, cero migración. No es sólido al 100 % (dos archivos distintos pueden compartir tamaño y mtime), pero es exactamente la heurística que el caché de miniaturas ya da por buena.
2. **Correcto, con migración** — romper el 1-a-1: una tabla de unión deck↔asset, de modo que los dos assets idénticos apunten a la misma fila en vez de robársela. Elimina el `relink` y con él la oscilación.
3. **Correcto, sin tocar `slide_decks`** — guardar el `content_hash` en `media_assets` al importar y que `statusesByAsset` haga join por hash. El import ya hace `stat`; hashear ahí cuesta (archivos de 6 MB × cientos), así que habría que hacerlo diferido o en segundo plano.

Sea cual sea, la regla que ya vale para el botón (`M39`) tiene que valer para la cuenta: **lo que el modal promete y lo que el lote realmente hace salen de la misma fuente**. Era la fuente la que hacía la pregunta equivocada; ahora pregunta por contenido.

### 5.6 Panel de recursos y grilla virtualizada (columna 1, abajo)

| id | Dónde | Qué | Coste |
|---|---|---|---|
| M29 ✅ | `asset-tile.tsx:64` | `failedUrls` es estado local de un componente que la virtualización desmonta: el registro de URLs que fallaron se pierde en cada scroll, así que un `.gif`/`.webp` sin miniatura vuelve a pedir su 404 en cada pasada | Medio con carpetas grandes de formatos no soportados. Fix: un `Set` de módulo o en la store |
| M30 ✅ | `thumb-tile.tsx:81` | `loadedSrc` también es local, así que un tile ya visto vuelve a mostrar el `Skeleton` al re-scrollear aunque la imagen esté en caché. Y si un `src` nunca carga, `loadedSrc` queda con el anterior y el skeleton es eterno (hoy lo rompe `onImageError` desde `AssetTile`, no el propio tile) | Bajo |
| M31 ✅ | `virtual-grid.tsx:121,162,248` | Tres cosas: `syncWidth`→`rowHeight`→nueva identidad de `recomputeWindow`→layout effect→`syncWidth` converge por el umbral de 0,5 px, pero si la aparición/desaparición de la barra de scroll cruza ese umbral puede oscilar; el listener de scroll se desmonta y remonta con cada cambio de ancho; y la aserción sólo-dev hace `querySelector` + `getBoundingClientRect` (lectura forzada de layout) en **cada cruce de fila**, para siempre, si la geometría está bien | Bajo-medio. Fix: `scrollbar-gutter: stable` en `PanelBody`, ref para el callback de scroll, y cortar la aserción tras la primera comprobación exitosa |
| M43 ✅ | `ResourcePanel.tsx:49` | Cambiar de pestaña **desmonta** `MediaBrowser`: se pierden statuses, rango visible, posición de scroll y `failedUrls`, y al volver se re-dispara todo el ciclo de `deck:statuses` + prewarm | Medio. Fix: mantener montadas las pestañas visitadas |
| M38 ✅ | `media-browser.tsx:133` | El cleanup del efecto llama `setVisiblePrewarm([])`, que **arma** un `setTimeout` de 300 ms — y el cleanup del hook de debounce ya corrió (se declara antes), así que ese timer queda huérfano | Menor |
| M39 ✅ | `media-browser.tsx:271` | `startBatchPrewarm` manda **todos** los assets, incluidos los `missing` y los ya `ready`, aunque el modal prometió `pendingDeckCount` | Menor |
| L4 ✅ | `media-browser.tsx:90` | `refresh(kind)` corre siempre, incluso en vista de carpeta donde `recentAssets` no se muestra: un `library:list` inútil por montaje | Menor |
| L5 ✅ | `media-source-bar.tsx:65` | Desvincular una carpeta no pide confirmación (no borra archivos, pero es un clic irreversible) | Menor |
| L6 ✅ | `ui/tabs.tsx` | El contenido no lleva `role="tabpanel"` ni `aria-controls`; existe un `TabPanel` sin usar. El `onKeyDown` del contenedor cambia de pestaña con flechas aun con el foco en un hijo | Menor (a11y) |

### 5.7 Proyección y reproducción

| id | Dónde | Qué | Coste |
|---|---|---|---|
| M40 ✅ | `ProjectionApp.tsx`, `output-view.tsx` | **Ningún `onError`** en el `<video>`, el `<audio>` ni los `<img>` del proyector. Si un archivo desaparece o no se puede decodificar a mitad de un culto, la proyección queda negra y el operador no se entera: los monitores muestran lo mismo, así que tampoco lo delatan | **Medio-alto.** Es el hueco más grande que queda tras esta sesión. Fix: `onError` → `mediaStatus` con un campo de error → cartel en el monitor LIVE |
| M25 ✅ | `projection.store.ts:233` | `selectOutputMemo` hace `JSON.stringify` del output completo **en cada notificación** del store (`setMediaStatus` dispara ~4/s por elemento sonando), y su caché es una variable de módulo de un solo slot: si dos suscriptores lo llaman con estados distintos, se pisa y devuelve objetos nuevos — el patrón que React documenta como causa de bucles de render con `useSyncExternalStore` | Medio. Fix: comparar campo a campo en vez de serializar, o memoizar por referencia de estado |
| M28 ✅ | `output-view.tsx:285` | La capa saliente de una transición se desmonta con `animationend`. Si la animación no corre (ventana ocluida — ver `.claude/knowledge/occluded-electron-window-has-no-rendering-lifecycle.md` — o `prefers-reduced-motion`), `animation-fill-mode: both` deja la escena vieja tapando la nueva | Bajo, pero el síntoma es el peor posible (el proyector no cambia). Fix: timeout de respaldo de `durationMs + margen` |
| M27 ✅ | `output-view.tsx:369` | El preload de diapositivas vecinas crea `new Image()` sin guardar referencia ni cancelar: navegando rápido por un deck largo quedan decenas de descargas en vuelo | Menor |
| M41 ✅ | `ProjectionApp.tsx:166` | El callback `ref` de cada pista es una closure nueva por render, así que React lo re-ejecuta (delete + set en el `Map`) en cada uno | Menor |
| M34 ✅ | `effects/deck-autoplay.ts:34` | Estado mutable de módulo (`timer`, `navEpoch`, `deadline`, `seededEpoch`) no reentrante: dos instancias compartirían el mismo timer, y `seededEpoch` no se resetea en el cleanup, así que tras un teardown/re-setup un deck reabierto arranca la música desde 0 en vez de desde la diapositiva actual | Bajo (hoy sólo StrictMode/HMR) |

### 5.8 Stores, hooks y utilidades

| id | Dónde | Qué | Coste |
|---|---|---|---|
| M35 ✅ | `settings.store.ts:22` | `update` escribe y **después** mergea: dos operaciones concurrentes que leen-modifican-escriben el mismo objeto (agregar una carpeta a `video` y quitar otra de `image`) se pisan | Medio. Fix: mergear optimista antes del `await`, o hacer el merge en main |
| M36 ✅ | `use-media-asset.ts:5` | Caché de módulo sin evicción (crece con cada asset visto) y sin `.catch`: un rechazo deja el id sin cachear, así que se reintenta en cada render | Bajo-medio |
| M44 ✅ | `deck.store.ts:162` | `cancelConversion` borra de `pending` pero la promesa en vuelo sigue viva y escribirá su resultado igual | Bajo (atenuado: ahora una cancelación llega como `CANCELED` y se mapea a `stale`, no a `failed`) |
| M37 ✅ | `lib/hooks/use-ipc-event.ts` | Código muerto (cero usos) y una trampa: con un callback inline daría de baja y alta el listener IPC en **cada render** | Menor. Fix: borrarlo o darle un ref interno |
| M33 ✅ | `stores/toast.store.ts:42` | `setTimeout` sin `clearTimeout`, sin límite de toasts simultáneos, y los que llevan `action` no expiran nunca | Menor |
| M32 ✅ | `ui/select.tsx:155` | El timer de typeahead no se limpia al desmontar | Menor |
| M45 ✅ | `bible-browser.tsx:64` | `itemRefs.current` nunca se trunca: al pasar de 500 resultados a 3 conserva 500 slots apuntando a nodos desmontados | Menor |
| M46 ✅ parcial | `AppShell.tsx:40` | El reparto `1fr / 1.1fr` es fijo, sin panel redimensionable ni altura mínima defensiva: con una ventana baja el `PanelBody` de recursos puede quedar en pocos píxeles y la grilla montar una sola fila | Menor |

---

## 6. Inventario transversal

**I/O síncrono en el hilo de main** (tras los arreglos de las dos sesiones): 30 llamadas en
`deck-service.ts`, 7 en `libreoffice.ts`, 6 en `zip-reader.ts`, 5 en `pptx-metadata.ts`, 5 en
`linked-audio.ts`, 3 en `rasterizer.ts`, más las de arranque (`migrate.ts`, `seed-bible.ts`,
`migrate-legacy-data.ts`). **Cero** en `thumbnail-service.ts` — el único módulo del pipeline
enteramente asíncrono, y el modelo a seguir.

El número por sí solo dejó de ser el indicador: lo que importa es **cuántos bytes** bloquea cada
llamada, no cuántas hay. Las 6 de `zip-reader.ts` son deliberadamente síncronas y leen kilobytes
(por eso pudo entrar sin volver `async` media cadena de llamadores — ver §4, M3); las que quedan
por revisar son las que leen o recorren algo de tamaño no acotado, y de ésas la única grande que
sobrevive en el camino caliente es `dirSize` (`M2`).

**Timers.** Main: `library-sweeper.ts:66` (`setInterval` de 5 min, de por vida — aceptable),
`index.ts:102` (prune diferido), `rasterizer.ts:56,202` (ambos con clear; el de idle con `unref`),
`libreoffice.ts:280,357`. Renderer: **ningún `setInterval`**; tres `setTimeout` sin clear garantizado
(M32, M33, M38), el resto correctos.

**Listeners DOM del renderer.** Los nueve `addEventListener` tienen su `removeEventListener`
correspondiente: `virtual-grid`, `tooltip`, `select`, `use-global-shortcuts`, `use-media-duration`,
`use-preview-media-status`, `Modal`, `ProgramsModal`, `output-view`. **Cero huérfanos.**

**Suscripciones IPC.** El puente del preload devuelve su `off` y los tres módulos de `effects/` lo
usan. Cero listeners duplicados.

**Observers.** Un solo `ResizeObserver` (`virtual-grid.tsx:103`) con `disconnect`. Ningún
`IntersectionObserver`: la carga diferida de miniaturas se apoya en `loading="lazy"` nativo más el
desmontaje por virtualización.

**`URL.createObjectURL` / blobs: cero ocurrencias en todo el renderer.** Toda la media se
direcciona por `worship://`, que es un token de capacidad resuelto en main. Es una decisión de
arquitectura que elimina de raíz una clase entera de fugas, y conviene no aflojarla.

**Caches sin cota, tras los arreglos.** Quedan: las colas de conversión y `inFlight` (sin tope de
tamaño), la cola de espera de miniaturas, el caché de `use-media-asset`, el de miniaturas (acotado
por edad pero no por tamaño) y el de decks (acotado por `cacheMaxMb` **pero** con la gracia de 24 h,
que puede dejarlo por encima del tope si todo es reciente).

---

## 7. Lo que está bien y conviene no romper

- **`worship://` como capability token.** Ninguna ruta de filesystem viaja en una URL; la
  resolución es por id de base de datos. Es lo que hace imposible el path traversal y lo que
  permite relocalizar un archivo sin remontar un reproductor. El soporte de `Range` (206 +
  `Accept-Ranges`) está completo y correcto, incluida la forma de sufijo y el 416.
- **La disciplina de `sofficeChain`.** Serializar toda invocación de LibreOffice contra el perfil
  compartido, con los rechazos absorbidos para no atascar la cadena, es la respuesta correcta al
  hallazgo de `soffice-shared-profile-race.md`.
- **La limpieza de listeners del rasterizador** (`contents.off` en `finish()`), con el comentario
  que explica el `MaxListenersExceededWarning` que la motivó.
- **`library-import.ts`** como modelo de "no bloquear": lock de proceso, chunks con yield, progreso
  con umbral y throttle, y la regla de que un canal `list*` nunca broadcastea su propia señal de
  refetch.
- **La geometría de `VirtualGrid`/`ThumbTile`**: `gridAutoRows` exacto, la aritmética en
  `thumb-tile.geometry.ts` impuesta por el CSS, roving tabindex, `aria-setsize`/`aria-posinset` y
  la fila enfocada siempre montada.
- **`use-media-duration.ts`** como ejemplo de elemento media imperativo bien gestionado (detached,
  listener removido, `src = ""` para cortar la descarga).
- **`projection-state.ts`**: el snapshot que la ventana de proyección *tira* al montar, en vez de
  un push a ciegas que se perdería en la ventana de carga.

---

## 8. Archivos tocados

### Segunda sesión (§4)

```
main:
  slides/zip-reader.ts                  M3        NUEVO  (lector de zip por offsets)
  slides/pptx-metadata.ts               M3        (readEntries -> readZipEntries)
  slides/linked-audio.ts                M3        (extractHintFromOoxml)
  slides/deck-service.ts                M1 M18    (hashFile async, reapOrphanedSoffice al init)
  slides/libreoffice.ts                 M18       (killTree immediate, reapOrphanedSoffice)
  services/library-import.ts            M13       (tope del prewarm)
  ipc/handlers/projection.ts            M40       (reportMediaError)

shared:
  types/projection.ts                   M40       (MediaErrorTarget, mediaErrorKey, ProjectionMediaError)
  ipc/contract.ts                       M40       (projection:reportMediaError + evento media-error)
  constants.ts                          M13       (PREWARM_EXPLICIT_MAX)

renderer:
  projection/ProjectionApp.tsx          M40       (reporta video/audio)
  components/shared/output-view.tsx     M40       (onError + banda de aviso, nunca en "live")
  components/shared/media-track-row.tsx M40       (prop `error`)
  components/pages/monitors/live-monitor.tsx      M40
  components/pages/monitors/preview-monitor.tsx   M40
  components/pages/monitors/live-media-panel.tsx  M40
  components/pages/schedule/SchedulePanel.tsx     M26
  components/pages/resources/bible-browser.tsx    M26
  stores/projection.store.ts            M40 M25   (mediaErrors; memo por referencia)
  effects/projection-sync.ts            M40       (media-error -> store + toast)
  lib/api.ts                            M40
  lib/hooks/use-media-asset.ts          M40       (getCachedMediaAsset)
  lib/i18n/messages/es.ts               M40
```

### Primera sesión (§3)

```
main:
  index.ts                              A6 A7 A8  (openControlWindow, userFacingWindows, reportCrash)
  services/projection-state.ts          C2        (clearWindowIf)
  ipc/handlers/projection.ts            C2
  ipc/handlers/programs.ts              A10       (adoptProgram)
  ipc/handlers/library.ts               A9
  services/library-import.ts            A9
  db/repositories/media.repo.ts         A9        (sweep asíncrono)
  db/repositories/history.repo.ts       A8
  db/repositories/bible.repo.ts         C3
  slides/deck-service.ts                C1 A1 A2 A3
  slides/libreoffice.ts                 A4
  slides/rasterizer.ts                  A5        (+ validación de payload.index)

shared:
  types/bible.ts                        C3        (SNIPPET_MARK_*, parseSnippet)

renderer:
  components/ui/highlighted-text.tsx    C3        NUEVO
  components/ui/index.ts                C3
  components/shared/error-boundary.tsx  B8        NUEVO
  lib/global-error-handlers.ts          B8        NUEVO
  app/App.tsx                           B8
  pages/resources/bible-browser.tsx     C3 B6
  pages/resources/ResourcePanel.tsx     B3
  pages/resources/media-browser.tsx     B4 B6 B7
  pages/resources/remove-asset-confirm.tsx  B6
  stores/program.store.ts               B1 B2
  stores/deck.store.ts                  B4
  stores/projection.store.ts            B5
  stores/library.store.ts               B7
  effects/projection-sync.ts            B5
  lib/actions/library-folders.ts        B7
  lib/i18n/messages/es.ts               B7 B8

scripts:
  db-smoke.ts                           C3        (aserción del snippet en el paso 5)
```

---

## 9. Verificación

### Automática — ejecutada

```
npm run typecheck   ✅
npm run lint        ✅  (5 warnings preexistentes)
npm run db:smoke    ✅  14/14, incluidas dos aserciones nuevas: el snippet de FTS5 no contiene
                        "<", lleva marcadores de control y parseSnippet preserva cada carácter; y
                        el estado de un deck se responde por contenido, no por propiedad (N3)
npm run build       ✅
```

De la segunda sesión, además — todo contra archivos reales, no sintéticos:

```
zip-reader, diferencial vs unzipSync   ✅  622 checks byte a byte
                                           (deflate / stored / zip64 / con comentario,
                                            4 .pptx reales, ~150 .pps que ambos rechazan)
npm run slides:smoke -- <.pptx 22,9MB> ✅  10 diapositivas, timings ooxml
npm run slides:smoke -- <522.pps>      ✅  14 diapositivas, timings ooxml-converted,
                                           audio vinculado resuelto
reaper de soffice, procesos reales     ✅  mata el del perfil propio, deja vivo el ajeno
                                           (rutas con "(" y "[" para probar el escapado)
```

### Manual — **corrida el 2026-09-13** contra la app real y la biblioteca real

Manejada por CDP (`--remoteDebuggingPort=9222`); la receta está en
[`.claude/knowledge/occluded-electron-window-has-no-rendering-lifecycle.md`](../../.claude/knowledge/occluded-electron-window-has-no-rendering-lifecycle.md).
Las 1–3 se corrieron en la tercera sesión; las 4–24, en la cuarta. Donde el escenario literal no
era reproducible se dice cuál se usó en su lugar y por qué es el mismo mecanismo.

| # | Qué se probó | Resultado |
|---|---|---|
| 1 | **C1** Cancelar la conversión de un PPT y volver a abrirlo | ✅ Cancelar a los 132 ms; reabrir convierte normal (11 miniaturas en 3,6 s) |
| 2 | **C2** Segunda `projection:open` con la ventana ya abierta, y cambiar de diapositiva | ✅ La ventana nueva sigue al deck; `projection:close` cierra de verdad |
| 3 | **C3** Versículo con `<img src=x onerror=…>` y búsqueda | ✅ Texto literal en un `<span>`, `<mark>` del tema, cero elementos inyectados |
| 4 | **A1/A3** Lote de 10 decks corriendo + `deck:ensure` del **último** del lote | ✅ Resolvió en **1303 ms**: se promovió fuera del carril de fondo, no esperó al chunk |
| 5 | **A9** Archivo de la biblioteca que desaparece, y navegar mientras tanto | ⚠️ **Parcial.** El sweep marca `missing_since` y lo limpia al reaparecer (observado sobre el asset 1522); la UI no se congeló. El caso literal —latencia de un pendrive desconectado— no es reproducible acá |
| 6 | **A6** Cerrar la ventana de control y reactivar la app | ✅ Reabre, **y** minimizarla vuelve a bajar la proyección (`visibilityState` `visible`→`hidden`): `wireMinimizeRestoreSync` quedó enganchado en la ventana nueva |
| 7 | **B1/B2** 3 ítems → borrar el primero → agregar otro → reordenar con algo EN VIVO | ✅ Renumera bien, sin colisión de keys, **cero warnings de consola**, y el riel EN VIVO se movió con su fila (posición 1→2) mientras el snapshot seguía en el mismo asset |
| 8 | **B3** Video seleccionado, pestaña Biblia activa, Delete y Backspace | ✅ No se borró nada: 4 videos antes y después, sin diálogo |
| 9 | **B7** Abrir una carpeta vinculada grande en frío | ✅ Se observó "Leyendo la carpeta…" y **nunca** un estado vacío |
| 10 | **B4/A1** Heap del renderer durante el lote | ✅ 23 → 21 → 20 → 25 MB: sin crecimiento monótono |
| 11 | **M40** Video EN VIVO, archivo borrado, proyector recargado | ✅ Las tres superficies: banda en el monitor LIVE, fila marcada, y el toast **«No se pudo reproducir «audit-video» en el proyector»**. El proyector: `innerText` vacío, ningún cartel |
| 12 | **M40** Imagen inexistente en PREVIEW | ✅ Banda de error en PREVIEW antes de ir al aire, y **sin** toast: un fallo local del control no es un fallo del proyector |
| 13 | **M40** Reponer el archivo y volver a mandarlo | ✅ Reproduce (`readyState 4`, `currentTime 5,5`) y todos los avisos desaparecen |
| 14 | **M13** Importar 30 presentaciones nuevas de golpe | ✅ **Exactamente 20** se convirtieron solas (705−685 filas); las otras 10 quedaron pendientes, y son exactamente las que la cuenta ofrece |
| 15 | **M18** SIGKILL a main durante una conversión (verificado: la conversión quedó a medias) | ✅ **Cero** `soffice` huérfanos, y la primera conversión del arranque siguiente funcionó (10 diapositivas, 3,5 s). En macOS `soffice` no sobrevive al SIGKILL del padre, así que el reaper quedó como respaldo, sin poder provocarle un huérfano real |
| 16 | **M9** Reconvertir el deck que está EN VIVO | ✅ Rechazado con el toast correcto, proyector intacto, fila 691 no borrada. Sacado del proyector, reconvierte normal (las miniaturas vuelven al caché) |
| 17 | **N1** NEGRO sobre un deck ~25 s y levantarlo | ✅ Vuelve exactamente a la diapositiva 4 del mismo deck |
| 18 | **M43** Scroll a 9000 px, cambiar a Videos, volver | ✅ `scrollTop` 9000 idéntico, misma ventana 231–254, 27 miniaturas cargadas, **0 skeletons**. El panel oculto sigue montado con sus 27 tiles, en `visibility:hidden` + `aria-hidden` |
| 19 | **M28** Transición sin animación (`prefers-reduced-motion: reduce`, el segundo disparador junto a la ventana ocluida) | ✅ 1→2→3→4 y **siempre una sola capa**, la nueva. Es justo el caso en que `animationend` no se dispara |
| 20 | **M47** Doble (y triple) clic en Guardar | ✅ El botón queda `disabled` en el **mismo tick** del primer clic; un solo programa guardado, un solo toast |
| 21 | **L5** Desvincular carpeta | ✅ Pide confirmación ("No se borra ningún archivo del disco"); cancelar conserva las dos carpetas |
| 22 | **M24** Borrar el programa cargado y empezar uno nuevo | ✅ El schedule se vacía, el header pasa a "No guardado", la fila de historial siguiente queda con `program_id` NULL y **cero filas huérfanas** apuntando al borrado |
| 23 | **M29/M30** 4 pasadas de scroll sobre 9 miniaturas que dan 404 | ✅ **9 pedidos, 9 distintos, 0 repetidos** en las cuatro pasadas; 0 skeletons |
| 24 | **M22/M7** 6 pasadas de scroll sobre 614 tiles + 25 seeks de video | ✅ Descriptores del proceso main **planos**: 146 total / 115 REG, sin variación |

Además, `N3` verificado de punta a punta en la app: las dos carpetas del himnario en **0
pendientes** con las 1227 tiles con miniatura, dos archivos byte a byte idénticos apuntando al
**mismo** deck (691), y el backfill repitiéndose idempotente tras un reinicio (1270/1270 sellados).

**Todo lo que estas pruebas agregaron a los datos del usuario se quitó después**: 61 assets de
prueba (`library:remove`), un programa temporal, 35 filas de deck con sus directorios de caché y
los archivos del scratch. La biblioteca quedó en 1235 `ppt` / 259 video / 2 imagen / 3 audio,
4 programas y 31102 versículos — idéntica a como empezó — y los 1235 `ppt` resuelven a un deck
`ready`.

### Lo que esta auditoría no pudo verificar

- ~~**Descriptores de archivo del protocolo** (M7)~~ — verificado en la cuarta sesión (prueba 24):
  planos tras 6 pasadas de scroll sobre 614 tiles y 25 seeks.
- **Linux** (M23): todas las miniaturas de imagen caen al camino síncrono; no se midió en esa
  plataforma.
- **Windows, para M18**: el reaper de huérfanos es sólo POSIX por diseño.
- **Un `soffice` realmente huérfano**: en macOS no sobrevive al SIGKILL del padre (prueba 15), así
  que el reaper no pudo ejercitarse contra uno real.
- **Una carpeta vinculada en un pendrive desconectado** (A9, prueba 5): sólo se pudo verificar la
  mitad que no depende del hardware.
- **Los tiempos reales del lote** antes/después de A1 y A3 contra los 624 decks reales: la prueba 4
  midió la promoción fuera del carril de fondo (1303 ms), no el lote completo.

---

## 10. Prioridad sugerida para lo que queda

Tras la quinta sesión (§4.3) **quedan dos hallazgos abiertos**, los dos de rendimiento, y los dos
por una razón explícita y no por falta de tiempo:

1. **`M23` — miniaturas en Linux.** Nulo en macOS/Windows. El arreglo (resize en la ventana
   offscreen del rasterizador) es un canal nuevo y un tipo de trabajo nuevo, escrito a ciegas para
   una plataforma que no se puede probar acá. Espera a que haya una máquina Linux.
2. **`M42` — paginar `library:list` / acotar `listFolder`.** Medido en la biblioteca real,
   `library:list("ppt")` devuelve 6 filas y `listFolder` ya trocea con yields; lo que queda es
   hipotético. El arreglo honesto es paginar de verdad, y eso es una feature con decisión de UI —
   un tope silencioso le mentiría al operador sobre cuántos archivos tiene su carpeta.

Y fuera del catálogo, sin cambiar de estado:

3. **`M19`, la mitad que falta:** validación de payload por canal. Es un refactor de ~100 canales
   con un esquema compartido, no un arreglo puntual.

### Todavía no verificable acá

- **Linux** (`M23`) — no hay máquina.
- **Windows, para `M18`** — el reaper de huérfanos es POSIX por diseño.
- **Un `soffice` realmente huérfano** — en macOS no sobrevive al SIGKILL del padre.
- **Una carpeta vinculada en un disco desenchufado** (`A9`) — sólo se pudo verificar la mitad que
  no depende del hardware.

---

## 11. El pase automático perdido — análisis completo

**Síntoma reportado por el usuario:** "en las dos carpetas, instrumental y cantado, las
presentaciones desde el número 51 hasta el 63 no tienen el pase automático aunque técnicamente
deberían".

**Veredicto:** no es culpa de los archivos, ni de nuestro parser. **Es una pérdida en el filtro de
exportación a `.pptx` de LibreOffice**, y el rango real es mucho más amplio que 51–63: **222 de los
1226 archivos del himnario**. Arreglado, con los 122 decks ya convertidos rellenados en sitio.

### 11.1 Las tres hipótesis, y cuál sobrevivió

El pedido era averiguar si el problema era del software, de la transformación o de los archivos.
Se descartaron dos por medición.

| Hipótesis | Cómo se probó | Resultado |
|---|---|---|
| **Los archivos no tienen pase automático** | Parser propio de OLE2 sobre los 1226 `.pps`, leyendo `SlideShowSlideInfoAtom` (MS-PPT 2.5.30) directamente del binario | **Falsa.** Los 1226 tienen `fAutoAdvance` y `slideTime` en el origen. Cero excepciones |
| **Nuestro parser no los lee** | Descomprimir el `.pptx` que produce la conversión y buscar `<p:transition>` a mano | **Falsa.** Para `051.pps` el `.pptx` convertido **no tiene ningún elemento `p:transition`**. No hay nada que leer: nuestro parser acierta |
| **La conversión los pierde** | Convertir los mismos archivos a `.odp` y mirar `presentation:duration` | **Verdadera, y con matiz importante** |

### 11.2 La causa exacta

LibreOffice **importa** los tiempos perfectamente. El mismo `051.pps` exportado a `.odp` trae cada
duración intacta:

```
051.odp → presentation:duration="PT15.958999999S", "PT28.922999999S", "PT27.597000000S", …
051.pptx → <sin p:transition en ninguna de las 8 diapositivas>
```

La pérdida está en el **filtro de exportación a PPTX**, y la condición es exacta:

> **LibreOffice sólo escribe el elemento `<p:transition>` cuando la diapositiva tiene un EFECTO
> visual de transición. `advTm` es un atributo de ese elemento — así que una diapositiva con
> "sin transición, avanzar a los 27 s" pierde los 27 s porque no queda dónde ponerlos.**

Se ve en el propio ODP, comparando una que sobrevive contra una que no:

```
050 (sobrevive):  presentation:duration="PT9.407S" … smil:type="randomBarWipe"
200 (sobrevive):  presentation:duration="PT14.985S" … smil:type="fade"
051 (se pierde):  presentation:duration="PT15.959S" … (sin smil:type)
055 (se pierde):  presentation:duration="PT15.303S" … (sin smil:type)
```

Y en el binario de origen, el discriminador es `SlideShowSlideInfoAtom.effectType == 0`.

**La correlación se verificó sobre toda la biblioteca, no sobre una muestra:** para los 672 decks
del himnario ya convertidos, "¿alguna diapositiva con efecto visual?" predice "¿tiene tiempos en
nuestra DB?" con **672 aciertos y 0 discrepancias**.

El PDF sufre lo mismo (`051.pdf` no tiene ninguna entrada `/Trans`), así que esa vía tampoco servía.

### 11.3 El alcance real

| | Archivos |
|---|---|
| `.pps` escaneados (Cantado + Instrumental) | 1226 |
| Con pase automático **en el origen** | **1226** (todos) |
| Que lo pierden **por completo** en la conversión | **208** |
| Que lo pierden en **algunas** diapositivas | 14 |
| Que lo conservan | 1004 |

Los himnos afectados son idénticos en las dos carpetas (son los mismos decks con distinto audio):

```
039, 041-048, 051-064, 205, 207-209, 220, 231, 406, 424, 429, 448, 454-455,
500-503, 505, 521-528, 531-535, 538-542, 544, 546, 549, 556-593, 595-599
```

**El rango 51–63 que reportó el usuario es el bloque contiguo más largo de la primera centena** —
por eso saltó a la vista ahí. El bloque 556–593 es todavía más grande.

### 11.4 El arreglo

**Opción elegida por el usuario: leer los tiempos del binario nosotros mismos.** La alternativa
(cambiar el round-trip legacy de `.pptx` a `.odp`) cuesta lo mismo en conversión pero obliga a
escribir un segundo parser de metadata completo —orden, ocultas, notas, audio embebido— y cambia el
camino de extracción de audio.

`src/main/slides/ppt-binary-timings.ts` (nuevo) lee el stream `PowerPoint Document` del archivo
OLE2 y devuelve los tiempos **en orden de presentación**. Tres decisiones que importan:

1. **Nunca lee el archivo entero.** En un `.pps` las imágenes viven en el stream `Pictures`: los
   records que se parsean son ~45 KB de un archivo de 1,4 MB. Los sectores se leen bajo demanda por
   un descriptor, igual que hace `zip-reader.ts`, y por la misma razón — este código corre en el
   hilo que atiende al proyector.
2. **El orden sale del camino documentado, no del orden en que los records caen en el stream**:
   `Current User` → el `UserEditAtom` más reciente → su directorio de persistencia → el
   `SlideListWithText` de diapositivas → un `SlidePersistAtom` por diapositiva, en orden.
3. **Sólo rellena huecos, y se autoverifica.** Un valor que el `.pptx` ya trae se deja quieto, y
   antes de rellenar nada se comparan las dos lecturas en cada diapositiva donde ambas tienen
   número. Vienen de caminos independientes: si el orden del lector binario estuviera mal,
   discreparían. **Una sola discrepancia y se abandona el merge entero** — un deck que avanza con
   el tiempo de otra diapositiva en pleno culto es peor que uno que no avanza.

Dos trampas del formato que costaron encontrar y quedan documentadas en el código:

- **Los bits de `fFlags` no son consecutivos.** MS-PPT intercala bits reservados: `fAutoAdvance` es
  `0x0400`, no el bit 5. Leídos como 0..6 —la lectura obvia— `fAutoAdvance` cae sobre `fLoopSound`
  y *todos* los decks parecen manuales.
- **`PP97_DUALSTORAGE`.** Un `.ppt` guardado para PowerPoint 95 y 97 a la vez deja el stream de 95
  en la raíz y el de 97 —el formato que parseamos— dentro de esa storage. Buscar por nombre sin
  recorrer el árbol de directorios elige el de 95, cuyos records son otro formato. Era el único de
  673 decks que volvía ilegible (`044.ppt`).

### 11.5 El backfill de lo ya convertido

`src/main/slides/backfill-timings.ts` (nuevo), diferido 2 s tras el arranque junto al backfill de
hashes. Cuatro reglas, en orden de importancia: el archivo tiene que seguir siendo **el que se
convirtió** (`(tamaño, mtime)` contra la fila), las cuentas de diapositivas tienen que coincidir,
las dos lecturas tienen que concordar, y el `UPDATE` lleva `advance_ms IS NULL` en el `WHERE` para
que sea imposible pisar un valor existente.

### 11.6 Verificado

Contra la app y la biblioteca reales, no contra fixtures:

| | Antes | Después |
|---|---|---|
| Decks legacy `ready` con pase automático | 554 de 676 | **676 de 676** |
| Diapositivas `ready` sin `advance_ms` | 1012 | **36** — y las 36 son de los 6 `.pptx` de verdad, que nunca tuvieron tiempos |
| Costo del backfill sobre 122 decks | — | **42 ms**, una vez, sin reconvertir nada |

**El himno 055 proyectado de verdad**, con el proyector abierto y su `.mp3` sonando — es uno de los
del rango que reportó el usuario y antes no avanzaba nunca:

| Transición | Reloj del audio medido | Frontera esperada |
|---|---|---|
| 1 → 2 | 15 431 ms | 15 303 ms |
| 2 → 3 | 45 401 ms | 45 208 ms |
| 3 → 4 | 76 290 ms | 76 190 ms |

Y el camino de **conversión nueva** (no sólo el backfill), importando dos copias a una carpeta
limpia: `063` convierte con sus 9 tiempos **sin redondear** (7219, 28156, 14890, …) porque salieron
del binario, y `200` con los suyos **redondeados al segundo** (15000, 15000, 14000, …) porque
LibreOffice sí los conservó y el merge no los tocó. La mezcla es visible en los propios datos.

`db:smoke` pasa de 14 a 15 checks: el nuevo **construye un `.ppt` OLE2 mínimo** —con su directorio
de persistencia, su lista de diapositivas y sus `SlideShowSlideInfoAtom`— y verifica la lectura, el
backfill, y que los dos guardas (lecturas que discrepan, origen que ya no coincide) dejen el deck
intacto. Sin binarios en el repo.

### 11.7 Lo que este hallazgo deja como regla

`deck_slides.advance_on_click` se escribe y **nadie lo lee**. Se dejó como está: darle valor desde
el binario sería cambiar comportamiento sin que nadie lo haya pedido.
