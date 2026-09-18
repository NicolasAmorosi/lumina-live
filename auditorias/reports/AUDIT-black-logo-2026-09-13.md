# Audit — Negro / Logo / En vivo (2026-09-13)

## Summary

- **Scope:** el camino completo del control del proyector — `lib/actions/playback.ts`,
  `lib/actions/bible.ts`, `stores/projection.store.ts`, `stores/display.store.ts`,
  `effects/projection-sync.ts`, `effects/end-of-playback.ts`, `lib/hooks/use-global-shortcuts.ts`,
  `components/pages/layout/TopBar.tsx`, `components/pages/monitors/**`,
  `components/pages/settings/sections/projection-section.tsx`, y del lado de main
  `ipc/handlers/projection.ts`, `services/projection-state.ts`, `windows/projection-window.ts`.
  Es la fila **#5** del índice, que estaba ⬜ **sin auditar**: la auditoría transversal de la
  cadena de media (`2026-09-11-cadena-de-media.md`) nunca nombra ninguno de estos archivos.
- **Verdict:** el modelo de estado es sólido —`selectOutput` como árbitro único, el overlay como
  capa y no como "esconder la ventana", la coalescencia en microtask, el pin de desalojo que
  sobrevive a NEGRO/LOGO. **Los defectos que aparecieron no están en qué se proyecta sino en el
  ciclo de vida de la ventana de proyección**: el control window nunca se entera de que el
  proyector dejó de existir, y dos acciones de configuración cambian el proyector por fuera de
  toda coordinación.
- **Findings:** 🔴 1 Critical · 🟠 3 High · 🟡 2 Medium · 🔵 1 Low · ⚪ 2 Info
  (más `N1`, encontrado y **arreglado** antes de esta auditoría — ver abajo).
- **Manual verification:** **Not run.** Los tres hallazgos principales necesitan una segunda
  pantalla física y, para `C1`, cerrar la ventana de proyección desde el sistema operativo. El
  checklist concreto queda en la sección final.

---

## Estado — qué se arregló en la misma sesión

El 🔴 y los tres 🟠 se arreglaron el mismo día que se escribió este informe. El diagnóstico de
arriba queda tal cual (es la foto); esto es lo que cambió.

| Hallazgo | Archivos | Qué se hizo |
|---|---|---|
| 🔴 `C1` | `shared/ipc/contract.ts`, `main/services/projection-state.ts`, `main/ipc/handlers/projection.ts`, `renderer/effects/projection-sync.ts` | Evento nuevo `projection-closed`. `clearWindowIf` ahora **devuelve** si de verdad limpió, y el `closed` solo emite cuando lo hizo — así un reopen (que entrega el `closed` de la ventana vieja después de registrar la nueva) y un cierre pedido por el propio control se quedan callados. El control pone `presentationOpen: false` al recibirlo |
| 🟠 `H1` | `renderer/lib/hooks/use-global-shortcuts.ts` | La supresión pasó a ser **por tecla, no por elemento**: un campo de texto sigue consumiendo todo; un `BUTTON`/`A` consume solo `Enter`, `Espacio` y las flechas. `b`, `l`, `Delete` y `Backspace` pasan siempre |
| 🟠 `H2` | `renderer/stores/display.store.ts` | `setDisplayId` reabre la ventana en la pantalla elegida si había una abierta. `projection:open` ya cerraba y recreaba; la ventana nueva se repinta sola con `projection:getSnapshot` |
| 🟠 `H3` | `renderer/lib/actions/live-intent.ts` **(nuevo)**, `playback.ts`, `bible.ts`, `display.store.ts` | El contador de intención salió de `playback.ts` a su propio módulo, que no importa nada y por lo tanto no puede formar un ciclo. `projectVerse` (y con él `advanceVerse`) y `display.store.open()` ahora lo reclaman |
| 🟡 `M2` | `projection.store.ts`, `playback.ts`, `use-global-shortcuts.ts`, `CLAUDE.md` | Las cuatro derivas de comentario, incluida la que el propio arreglo de `H1` invalidó |

**Quedan abiertos, catalogados a propósito:** `M1` (el audio se reinicia al reabrir el proyector),
`L1` (EN VIVO sin pantalla resuelta) y los dos ⚪. Ninguno rompe un culto.

Barra mínima después de los arreglos: `typecheck` limpio, `lint` 5 warnings preexistentes,
`db:smoke` 15/15, `build` 3 bundles. **El checklist manual del final sigue sin correr** — necesita
una segunda pantalla.

---

## Estado — segunda pasada (2026-09-13, misma fecha)

Se cerraron los hallazgos que habían quedado abiertos y **se corrió el checklist manual** contra
la app real por CDP, con un `userData` aislado (la biblioteca real del usuario no se tocó).

| Hallazgo | Archivos | Qué se hizo |
|---|---|---|
| 🟡 `M1` | `lib/actions/live-positions.ts` **(nuevo)**, `audio.store.ts`, `projection.store.ts`, `display.store.ts`, `effects/projection-sync.ts` | `freezeLivePositions()` pliega la última posición reportada (`mediaStatus`) dentro del `startAtSeconds` de cada pista de audio **y del video en vivo**, en los tres caminos que destruyen la ventana: el `projection-closed` (⌘W/crash), `display.store.close()` y el reopen de `setDisplayId`. El guard de epoch es el mismo de `end-of-playback.ts`. `epoch` NO se toca: nada debe remontar mientras el proyector que se está describiendo sigue en pantalla |
| 🔵 `L1` | `display.store.ts`, `stores/ui.store.ts` **(nuevo)**, `App.tsx`, `lib/i18n/messages/es.ts` | `openIfNeeded()` ahora espera a `load()` si todavía no corrió (dedupeado con una promesa in-flight, porque el primer EN VIVO le puede ganar al arranque) y, si aun así no hay pantalla, levanta un toast con acción que abre Ajustes → Pantalla. La bandera del modal de Ajustes subió a un store mínimo porque una acción de toast no tiene árbol de React debajo |
| ⚪ LIMPIAR | — | **Decisión deliberada del usuario: se queda dentro de Ajustes.** Es destructiva y el modal la protege de un clic accidental en la cabina. El ⚪ queda cerrado, no pendiente |
| ➕ `N2` (fuera del informe) | `effects/projection-sync.ts`, `lib/toast.ts` | El cierre de `C1` era mudo: la cabecera pasaba a «Sin pantalla» y nada más, y el operador mira a la congregación, no al chrome. Ahora el `projection-closed` levanta un toast persistente («Se cerró la ventana de proyección» + **Reabrir**) que se retira solo en cuanto el proyector vuelve por cualquier vía. Reabre con `openIfNeeded()`, no con `open()`: `open()` cae en NEGRO y obligaría a un segundo EN VIVO, que reenvía el target de **preview**, no lo que la congregación estaba viendo |

### Lo que `M1` escondía: el deck no solo reiniciaba la música, volvía a la diapositiva 1

El informe describía `M1` como «el audio vuelve al segundo 0» y daba por cubierto el caso del deck
(«el audio del deck se re-sincroniza solo con `deck-autoplay`»). **No se re-sincroniza.** El
`seededEpoch` de `deck-autoplay.ts:260` se consume en el primer `media-status` de la primera
reproducción del deck, y reabrir la ventana no toca `soundtrackEpoch` — así que el bloque de
recuperación («reopening the projection window mid-deck gives us a fresh `<audio>` that starts at
0») **nunca vuelve a entrar**. Con la pista de vuelta en 0 y el modo «synced» derivando el cursor
del reloj de audio, `slideAtAudioTime` devolvía 1 y arrastraba el deck a la primera diapositiva
delante de la congregación.

Verificado como A/B en la app real: con el congelado desactivado, un deck en la diapositiva 4 con
la banda sonora en 95 s volvió a **la diapositiva 1** y al segundo ~6,8; con el congelado puesto,
se quedó en la 4 con el audio en 104 s.

### Checklist manual — ejecutado por CDP

App real (`electron-vite dev -- --remote-debugging-port=9222 --user-data-dir=<aislado>`), decks y
media reales del usuario (`~/Downloads/PPT test/`, un mp3 de 9 min, un mp4 de 2 min).

| # | Caso | Resultado |
|---|---|---|
| 1 | `C1` — matar la ventana de proyección desde el sistema | ✅ la cabecera pasa a «Sin pantalla», aparece el toast con **Reabrir**, y reabrir restaura lo que estaba en vivo. El toast se retira solo |
| 2 | `H1` — clic en LOGO (con foco real en el `<button>`) y después `B` | ✅ `b`/`l` llegan al proyector (`logo → black → logo → black`); `ArrowDown` sigue suprimido sobre el botón, como debe |
| 3 | `H2` — cambiar de pantalla con la ventana abierta | ⛔ **no verificable**: una sola pantalla física |
| 4 | `M1` audio — pista suelta | ✅ 8,29 s → congelada en 8,28 → retoma en 12,07 tras reabrir |
| 4b | `M1` video — video en vivo + pista suelta a la vez | ✅ video 10,92 → 10,81 → 14,75; audio 45,16 → 45,12 → 49,11, independientes |
| 4c | `M1` deck — banda sonora enlazada, modo «synced» | ✅ diapositiva 4 y 97,3 s congelados; tras reabrir, diapositiva **4** y 104,1 s (A/B sin el fix: diapositiva **1**) |
| 5 | `N1`/`H3` — NEGRO durante una conversión | ✅ EN VIVO sobre un `.pptx` de bytes nuevos + NEGRO 300 ms después: el deck llegó a `ready` y el proyector siguió en NEGRO 25 s más. El commit superado se descartó |
| — | `L1` — EN VIVO sin pantalla resuelta | ⛔ **no verificable**: `displays.list()` nunca vuelve vacío en una máquina real. El camino quedó razonado y con typecheck, no ejercitado |

Barra mínima tras esta pasada: `typecheck` limpio, `lint` 5 warnings preexistentes, `db:smoke`
15/15, `build` 3 bundles.

**Nota de paso, sin arreglar:** con un `userData` recién creado (sin logo configurado) el output
LOGO reporta `media error scene worship://logo`, porque `LOGO_URL` no resuelve a ningún archivo.
No pertenece a esta auditoría y no rompe nada — el proyector queda en negro y el aviso solo lo ve
el operador — pero es la primera impresión de una instalación nueva.

---

## Surface inventory

| Capa | Archivos |
|---|---|
| Contrato IPC | `shared/ipc/contract.ts` — `projection:open`, `:close`, `:show`, `:mediaCommand`, `:setAudioTracks`, `:getSnapshot`, `:reportMediaStatus`, `:reportMediaError`; eventos `display-content`, `media-command`, `audio-tracks`, `media-status`, `media-error` |
| Tipos | `shared/types/projection.ts` — `BaseContent`, `OverlayState`, `ProjectionOutput`, `VideoUnderlay`, `SceneTransition` |
| Main | `ipc/handlers/projection.ts`, `services/projection-state.ts`, `services/broadcast.ts`, `windows/projection-window.ts` |
| Stores | `projection.store.ts` (`base`/`overlay`/`videoPaused`/`liveDeck`/`sceneEpoch`, `selectOutput`, `selectOutputMemo`), `display.store.ts`, `audio.store.ts` |
| Acciones | `lib/actions/playback.ts` (`goLive`, `clearLive`, `clearBaseContent`, `toggleOverlay`, `setOverlayDirect`, `advanceSlide`, `gotoSlide`), `lib/actions/bible.ts` (`projectVerse`, `advanceVerse`) |
| Efectos | `effects/projection-sync.ts`, `effects/end-of-playback.ts`, `effects/deck-autoplay.ts` |
| UI | `layout/TopBar.tsx` (LOGO/NEGRO/VIVO + EN VIVO), `monitors/**`, `settings/sections/projection-section.tsx`, `lib/hooks/use-global-shortcuts.ts` |
| Render compartido | `components/shared/output-view.tsx` (`OutputView`, `LiveVideo`) |

---

## Findings

### 🔴 Critical

#### [MAIN + RENDERER] El control window nunca se entera de que el proyector se cerró

- **Where:** `src/main/windows/projection-window.ts:57` (no hay `win.on("closed")` que avise),
  `src/main/ipc/handlers/projection.ts:38` (el único `closed` registrado solo limpia la
  referencia de main), `src/renderer/src/stores/display.store.ts:60`.
- **Issue:** `presentationOpen` en `projection.store.ts` solo lo escriben `display.store.open()`,
  `openIfNeeded()` y `close()` — es decir, **solo cuando el cierre lo pidió el propio control**.
  Main sabe que la ventana murió (`projectionState.clearWindowIf`) pero **no existe ningún evento
  que lo comunique**: `IpcEvents` no tiene un canal para esto. Y la ventana puede morir sin que el
  control lo pida: `Menu.setApplicationMenu` no se llama en ningún lugar de `src/main/`, así que el
  menú por defecto de Electron está activo y **⌘W cierra la ventana de proyección enfocada**;
  además un crash del renderer o un cierre forzado producen lo mismo.
- **Impact:** el control queda convencido de que hay proyector para siempre. Tres consecuencias, en
  orden de gravedad:
  1. `openIfNeeded()` corta en la primera línea (`if (presentationOpen) return`), así que
     **EN VIVO, NEGRO y LOGO dejan de llegar a ningún proyector, en silencio** — `projection:show`
     viaja a main y `projectionState.getWindow()` devuelve `null`, que es un descarte mudo.
  2. `MonitorsColumn` calcula `broadcasting = presentationOpen && overlay === "none" && base !== null`,
     así que **el punto rojo de EN VIVO sigue parpadeando** y `useLiveStatus()` devuelve `""` en vez
     de "desconectado". Viola directamente la regla de `CLAUDE.md`: *los monitores nunca le mienten
     al operador*.
  3. La única recuperación es entrar a Ajustes → Pantalla, apretar "cerrar" (que no cierra nada,
     pero pone `presentationOpen: false`) y volver a abrir. Nada en la UI insinúa eso.
- **Fix:** un evento nuevo `projection-closed` en `IpcEvents`, emitido con `broadcast()` desde el
  mismo `closed` que ya hace `clearWindowIf`, y un `onIpc("projection-closed")` en
  `projection-sync.ts` que llame `setPresentationOpen(false)`. Tiene que ser identity-checked igual
  que `clearWindowIf` — si no, el `closed` de la ventana vieja durante un reopen apagaría la bandera
  de la nueva, que es exactamente el bug ya documentado en
  [`a-replaced-windows-closed-listener-must-check-identity.md`](../../.claude/knowledge/a-replaced-windows-closed-listener-must-check-identity.md).

### 🟠 High

#### [RENDERER] B y L (NEGRO/LOGO) dejan de funcionar en cuanto el operador hace clic en cualquier botón

- **Where:** `src/renderer/src/lib/hooks/use-global-shortcuts.ts:11` (`INTERACTIVE_TAGS`), `:41`.
- **Issue:** `INTERACTIVE_TAGS` incluye `BUTTON`, y el handler descarta **todas** las teclas cuando
  el foco está en uno. Chromium enfoca un `<button>` al hacerle clic, así que después de apretar
  EN VIVO, LOGO, NEGRO, guardar, o cualquier `IconButton` de la app, el foco queda ahí. La
  supresión es correcta para Enter, Espacio y las flechas —un botón los maneja de forma nativa, y
  las flechas manejan el roving tabindex de la grilla— pero **`b`, `l`, `Delete` y `Backspace` no
  tienen ningún comportamiento nativo en un botón que haya que proteger**.
- **Impact:** NEGRO es el control de emergencia de la app: es lo que se aprieta cuando aparece algo
  que la congregación no tiene que ver. Tras un solo clic en cualquier botón, la tecla **no hace
  nada y no da ninguna señal de por qué**, en una cabina a oscuras. El operador puede recuperar el
  atajo haciendo clic en un área vacía, pero nada se lo indica.
- **Fix:** separar la supresión por tecla en vez de por elemento: `INPUT`/`SELECT`/`TEXTAREA`/
  `contentEditable` siguen suprimiendo todo; en `BUTTON`/`A` suprimir solo las teclas que el
  elemento realmente consume (`Enter`, `" "`, las cuatro flechas) y dejar pasar `b`/`l`/`Delete`.

#### [RENDERER] Cambiar la pantalla del proyector con la ventana abierta no hace nada

- **Where:** `src/renderer/src/stores/display.store.ts:46` (`setDisplayId`),
  `src/renderer/src/components/pages/settings/sections/projection-section.tsx:50`.
- **Issue:** `setDisplayId` escribe el store y persiste `projection.displayId`, y **nada más**. No
  hay ningún efecto ni suscriptor que reaccione a ese cambio (verificado: el único otro uso de
  `displayId` en todo el renderer es `api.ts:20`, la llamada a `projection:open`). El handler
  `projection:open` de main sí sabe cerrar la ventana existente y recrearla en la pantalla pedida,
  pero nadie lo invoca.
- **Impact:** el operador elige la pantalla correcta en Ajustes y la proyección sigue en la
  equivocada, sin ningún aviso. Es el flujo de puesta a punto más común de toda la app, y el
  `Select` se ve como si hubiera surtido efecto. Para arreglarlo hay que adivinar que se cierra y
  se vuelve a abrir la ventana desde la fila de al lado.
- **Fix:** en `setDisplayId`, si `presentationOpen` es `true`, llamar `api.projection.open(id)`
  después de persistir — `projection:open` ya cierra y recrea, así que es una línea. La ventana
  nueva se repinta sola con `projection:getSnapshot`.

#### [RENDERER] `advanceVerse` y `display.store.open()` cambian el proyector por fuera del guard de intención

- **Where:** `src/renderer/src/lib/actions/bible.ts:11` (`projectVerse` → `setBase` directo),
  `:21` (`advanceVerse`), `src/renderer/src/stores/display.store.ts:51`
  (`open()` → `setOverlay("black")`).
- **Issue:** `playback.ts` acaba de ganar un contador de intención (`liveIntent`, ver `N1`) para que
  un deck que terminó de convertirse tarde no aterrice encima de lo que el operador hizo mientras
  tanto. `advanceSlide`/`gotoSlide` lo reclaman; **`advanceVerse` no**, aunque hace exactamente lo
  mismo del lado de los versículos: mover con ←/→ lo que la congregación está viendo. Lo mismo
  `display.store.open()`, que pone el overlay en NEGRO al abrir la pantalla. El contador es privado
  del módulo `playback.ts`, así que ningún otro archivo puede reclamarlo aunque quiera.
- **Impact:** el agujero que `N1` cerró queda abierto para dos caminos. Navegar la escritura en vivo
  durante una conversión y que el deck aparezca encima del versículo es el mismo síntoma
  inexplicable, con otra ropa.
- **Fix:** extraer el contador a su propio módulo (`lib/actions/live-intent.ts`), que no importa
  nada y por lo tanto no puede formar un ciclo con `playback.ts` ni con `bible.ts`, y reclamarlo
  desde `projectVerse` y desde `display.store.open()`.

### 🟡 Medium

#### [MAIN] Cerrar y reabrir el proyector reinicia todo el audio en vivo desde su offset original

- **Where:** `src/main/services/projection-state.ts:50` (`setAudioTracks` guarda `lastAudioTracks`),
  `:56` (`getSnapshot`), `src/renderer/src/projection/ProjectionApp.tsx` (consume el snapshot).
- **Issue:** `AudioTrackPush.startAtSeconds` es dónde arrancar, no dónde va la reproducción ahora.
  El snapshot replica el valor con el que la pista nació, así que la ventana nueva monta cada
  `<audio>` en su punto de partida.
- **Impact:** una pista de fondo de diez minutos vuelve al segundo 0. El escenario es poco frecuente
  (cerrar el proyector con audio sonando), y el audio del deck se re-sincroniza solo con
  `deck-autoplay`, pero una pista de asset no.
- **Fix:** que el snapshot devuelva la posición reportada más reciente (`mediaStatus` ya la tiene en
  el control) en vez del `startAtSeconds` original, o aceptarlo y documentarlo como límite.

#### [DOCS] Tres comentarios describen una UI que ya no existe

- **Where:** `src/renderer/src/stores/projection.store.ts:69` (la lista de quién sube `sceneEpoch`
  omite `toggleOverlay()`, que sí llama `beginScene()`), `src/renderer/src/lib/actions/playback.ts`
  (el docstring de `clearLive` dice "el botón LIMPIAR", pero vive en una fila de Ajustes desde la
  reorganización), `CLAUDE.md` (el mapa de carpetas lista `layout/StatusBar`, que ya no existe —
  `layout/` tiene solo `AppShell.tsx` y `TopBar.tsx`).
- **Impact:** nulo en runtime; es exactamente la clase de deriva que hace que la próxima sesión
  busque un archivo que no está.
- **Fix:** corregir los tres.

### 🔵 Low

#### [RENDERER] EN VIVO sin pantalla resuelta no proyecta ni avisa

- **Where:** `src/renderer/src/stores/display.store.ts:62` (`if (displayId === null) return`).
- **Issue:** `openIfNeeded()` se rinde en silencio y `goLive()` sigue adelante: el store se
  actualiza, los monitores muestran el contenido y nada llega a ningún lado.
- **Impact:** acotado, y **no miente**: `presentationOpen` sigue en `false`, así que la cabecera
  dice "desconectado" y el punto de EN VIVO no parpadea. Lo que falta es el empujón a elegir una
  pantalla. Solo alcanzable si `displays.list()` vino vacío o `load()` todavía no corrió.
- **Fix:** un toast con acción que abra Ajustes → Pantalla.

### ⚪ Info

- **LIMPIAR vive dentro del modal de Ajustes.** `clearLive()` —la única acción que corta todo el
  audio, y la que el docstring llama "LIMPIAR means silence"— solo es alcanzable desde
  `projection-section.tsx`, y `useGlobalShortcuts` está suspendido mientras hay un modal abierto.
  Es una decisión de producto defendible (es destructiva), pero conviene que sea deliberada.
- **`N1` — la carrera de `goLive()`, encontrada y arreglada antes de esta auditoría.**
  `goLiveWithDeck` escribía `base`/`overlay` después de `await deckStore.ensure()` sin comprobar
  nada, así que un deck que tardaba en convertirse aterrizaba encima de lo que el operador hubiera
  hecho mientras tanto — incluido **destapar un NEGRO que acababa de poner**. Arreglado con
  `liveIntent` en `playback.ts`: toda acción que cambia el proyector reclama una intención antes de
  su primer `await`, y todo commit que cruza un `await` verifica que la suya siga siendo la última.
  El descarte es silencioso a propósito. `H3` es la mitad que faltaba.

---

## Coverage matrix

| Caso | Main | Renderer |
|---|---|---|
| Paridad contrato ↔ `Handlers` (`npm run typecheck`) | ✅ | n/a |
| Llamadas `window.worship.*` huérfanas | n/a | ✅ ninguna |
| `selectOutput` exhaustivo para este tipo de contenido | n/a | ✅ `switch` exhaustivo sobre `BaseContent` |
| Flujo de dos etapas (seleccionar ≠ proyectar; solo `goLive()`) | n/a | ✅ un solo camino, 6 call sites |
| NEGRO/LOGO sobre un video en vivo (pausa + reanuda, el audio del deck sigue) | ✅ el pin de desalojo sobrevive al overlay | ✅ `videoUnderlay` + `covered={output.kind !== "video"}` |
| Estados loading / empty / error | ✅ | ⚠️ falta el de "el proyector se fue" (`C1`) |
| `worship://` `Range` / 206 | ✅ intacto | n/a |
| LibreOffice ausente → degradación | n/a en esta feature | n/a |
| Solo tokens semánticos (cero color/sombra/radio hardcodeado) | n/a | ✅ cero `#hex` en `pages/**` |
| Todo el texto por `useT()` | n/a | ✅ |
| Ventana de proyección sin lógica de dominio | ✅ | ✅ función pura de `ProjectionOutput` |
| Ciclo de vida de la ventana de proyección | ❌ `C1` | ❌ `C1`, `H2` |

---

## Not verified / assumptions

- **Todo lo que necesita una segunda pantalla física.** Se auditó en un equipo de una sola pantalla,
  donde `createProjectionWindow` cae en la rama `singleMonitor` (ventana de 800×600 centrada, sin
  fullscreen ni `alwaysOnTop`). `H2` en particular **no se pudo ejercitar**: con una sola pantalla
  el `Select` tiene una sola opción.
- **⌘W sobre la ventana de proyección.** El razonamiento de `C1` se apoya en que
  `Menu.setApplicationMenu` no se llama en ningún lado de `src/main/` (verificado por `grep`), y por
  lo tanto el menú por defecto de Electron —que en macOS incluye Window → Close (⌘W)— está activo.
  **No se ejecutó la app para confirmar el atajo.** Aun si ⌘W resultara no estar ligado, un crash
  del renderer de proyección produce el mismo estado, así que el hallazgo no depende de eso.
- **Un display desconectado en caliente.** No hay `screen.on("display-removed")` en `src/main/`;
  qué hace Electron con una ventana en una pantalla que desaparece no se verificó.

## Manual checklist (pendiente)

1. Con dos pantallas: proyectar algo, enfocar la ventana de proyección y cerrarla con ⌘W.
   Confirmar que la cabecera pasa a "desconectado", que el punto de EN VIVO deja de parpadear y que
   volver a apretar EN VIVO **reabre** el proyector. (`C1`)
2. Hacer clic en el botón LOGO y después apretar `B` sin tocar nada más. Confirmar que el proyector
   pasa a NEGRO. (`H1`)
3. Con el proyector abierto, cambiar la pantalla en Ajustes → Pantalla. Confirmar que la proyección
   se mueve sin cerrar y abrir a mano. (`H2`)
4. Proyectar un capítulo, navegar versículos con ←/→ mientras un `.pps` grande se convierte en
   segundo plano. Confirmar que al terminar la conversión el deck **no** aparece. (`H3`)
5. Repetir 4 con NEGRO puesto en vez de navegando: el NEGRO no se debe levantar solo. (`N1`)
