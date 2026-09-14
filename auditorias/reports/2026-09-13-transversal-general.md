# Auditoría — transversal general: todo lo que las auditorías anteriores no cubrieron

**Fecha:** 2026-09-13 (séptima sesión del proyecto, primera de esta auditoría)
**Alcance:** el complemento exacto de lo ya auditado. Las features **7 (monitores)**, **8
(diapositivas)** y **9 (programas y ajustes)** del índice, más los ejes transversales que ninguna
de las dos auditorías previas miró: **design system** (`components/ui/**`), **accesibilidad**,
**i18n**, **hardening de Electron**, **configuración de build y dependencias**, **capa de datos no
cubierta** (`programs.repo`, `history.repo`, `settings.repo`, `migrate.ts`) y **código muerto /
features a medio cablear**.
**Base:** `src/` completo, 23.213 líneas, 180 archivos. Rama `fix/golive-race-and-live-audit`,
sobre el árbol de trabajo actual (incluye los cambios sin commitear de la feature #5).
**Método:** lectura estática exhaustiva de lo no cubierto + verificación de cada afirmación fuerte
contra el código + tres comprobaciones **medidas** (ratios de contraste WCAG calculados sobre los
tokens reales, cruce de claves i18n usadas vs. definidas, y barrido de exports/canales sin
consumidor). Contrastado con la documentación oficial de Electron, SQLite, typescript-eslint y las
guías WCAG/ARIA vigentes — las fuentes están al pie.
**Report-only: no se arregló nada.**

---

## 1. Resumen ejecutivo

**76 hallazgos**: **2 bloqueantes**, **9 altos**, **31 medios**, **20 bajos** y **14 informativos**.

El código que ya fue auditado está, en general, en muy buen estado — las dos auditorías previas
cerraron lo que había. Lo que aparece acá es de otra naturaleza: **no son regresiones del pipeline
de media, son huecos estructurales en los bordes que nadie miró todavía.** Tres patrones los
explican casi todos:

1. **El proceso main está endurecido hacia adentro y abierto hacia afuera.** `contextIsolation`,
   `sandbox`, CSP, allowlist de senders confiables, `worship://` como token de capacidad: todo eso
   está y está bien. Lo que falta son las dos líneas que Electron documenta como obligatorias desde
   hace años — `will-navigate` y `setWindowOpenHandler` — y su consecuencia práctica es el
   hallazgo **`C1`**: **soltar un archivo en cualquier zona de la ventana de control que no sea una
   de las dos zonas de drop navega la ventana fuera de la aplicación.** En pleno culto eso es la
   app cerrada hasta reiniciar.

2. **El contrato IPC es de compilación, no de ejecución.** `IpcContract` garantiza que main y
   renderer se entienden *en el build*. En runtime, `registerHandlers` castea `req: unknown` al tipo
   declarado y ningún handler valida nada. Para casi todos los canales eso es inofensivo (el sender
   está en allowlist), pero `settings:set` escribe en la base **cualquier clave con cualquier
   valor** — el tipo `SettingsMap` no existe en el momento del `INSERT`.

3. **Hay tres features completas cableadas de punta a punta sin ningún punto de entrada en la UI.**
   `library:relocate` (contrato + handler + repo + `api.library.relocate` + la cadena i18n
   "Relocalizar…"): **cero call sites**, así que un archivo faltante no tiene camino de
   recuperación. `media.volume` + `MediaCommand{action:"setVolume"}`: el proyector sabe aplicar un
   volumen que nadie le manda nunca — **la app no tiene control de volumen**. Y los ítems de
   programa `kind: "text"` viven en el esquema, el DTO, el repo, el preview y el proyector, pero
   **no hay forma de crear uno**.

El eje con peor resultado medido es la **accesibilidad del tema oscuro**, que es el tema por
defecto y el que se usa en cabina. La fórmula del `Badge` (`bg-<color>/20 text-<color>`: tinte y
texto del mismo tono) produce **entre 2,18:1 y 3,19:1 en las cinco variantes**, contra el 4,5:1 que
WCAG AA pide para texto pequeño. Y el peor caso no es un badge decorativo: es
**`text-danger` sobre `bg-card` a 2,35:1 — el mensaje de "este archivo no se pudo reproducir" en
`MediaTrackRow`**, exactamente el texto que el operador tiene que poder leer a oscuras y de
reojo. La corrección es barata y está medida en §6: conservar el tinte y usar `text-foreground`
lleva los cinco badges de ~2,2–3,2 a **~12,5–13,8**.

Los dos bloqueantes, en una línea cada uno:

1. **Soltar un archivo fuera de una zona de drop navega la ventana de control fuera de la app**
   (`C1`) — no hay `preventDefault` a nivel documento ni guard de navegación en main.
2. **Electron 36 está en fin de vida y no recibe parches de seguridad** (`C2`) — instalado 36.4.0,
   la línea soportada actual es 44.x, y esta app decodifica media y parsea JSON y ZIP que aporta el
   usuario.

### Barra mínima — estado actual

Verde, sin tocar nada:

```
npm run typecheck   ✅
npm run lint        ✅  (5 warnings preexistentes de react-refresh)
```

Que esté verde es parte del diagnóstico: **ninguno de los 76 hallazgos es visible para el toolchain
actual**, porque el toolchain no los busca. Ver `H7` (ESLint sin reglas con información de tipos ni
de accesibilidad).

---

## 1.bis Estado — Tanda 1 aplicada (2026-09-13, misma fecha)

**6 de los 76 hallazgos cerrados.** Es exactamente la "Tanda 1" de §10, con dos decisiones del
usuario que se apartaron de lo recomendado en el informe y están anotadas abajo.

| # | Hallazgo | Qué se hizo |
|---|---|---|
| 🔴 `C1` | Un archivo soltado fuera de una zona de drop navega la ventana fuera de la app | Las **tres capas**, no una. Main: `src/main/windows/navigation-guards.ts` — `will-navigate` permitido solo si el destino coincide con la página cargada por **origen + pathname** (query y hash ignorados, para que el reload de HMR siga pasando), `setWindowOpenHandler` deniega, `will-attach-webview` deniega; instalado desde un único `app.on("web-contents-created")` en `index.ts`, así que cubre las tres ventanas —control, proyección y el rasterizador— y cubre también la próxima que se cree. Renderer: `src/renderer/src/lib/drop-guard.ts`, llamado desde `main.tsx` y `projection.tsx`, acotado a arrastres que llevan `Files` (todo arrastre interno usa un MIME propio, así que **ningún flujo de reordenamiento puede verse afectado**) y usando `defaultPrevented` para distinguir "sobre una zona de drop" de "sobre el vacío", que es lo que permite mostrar el cursor de *no soltar acá* en vez de mentirle al operador con un cursor de copia |
| 🟠 `H4` | `Supr` borra un recurso sin ninguna confirmación | **Decisión del usuario: toast con "Deshacer", no modal de confirmación.** Implementado como **borrado diferido**, no como restauración: el recurso desaparece de la grilla en el acto pero `library:remove` **no se envía** hasta que se cierra la ventana de 7 s. El undo es un undo de verdad porque no pasó nada — restaurar re-importando habría devuelto un asset **distinto** (id nuevo, y con él el audio vinculado, el flag `inLibrary` y el lugar de la fila en el orden de culto sin guardar). Un recurso usado por un programa guardado se detecta **antes** (`library:usages`) y va directo al flujo de confirmación forzada que ya existía, para que la rechazo no aparezca 7 s tarde |
| 🟠 `H7` | El contraste del tema oscuro falla WCAG en casi todo el color | **Decisión del usuario: las 8 variantes con color, no solo las 5 de contenido.** Mismo tinte, texto a `text-foreground`: de 2,18–3,19:1 a ~12,5–13,8:1. `blue`/`danger`/`success` pasan de `/15` a `/20` para que ninguna variante quede como una versión más débil de las otras ahora que ninguna lleva el tono en el texto. `neutral` se deja igual: nunca fue color-sobre-su-propio-tinte. **La otra mitad sigue abierta** — `text-danger`, `text-primary` y `text-subtle` sobre `bg-card` necesitan la rampa "on-dark" en `globals.css`, que es Tanda 2 |
| 🟠 `H8` | El lockfile está en `.gitignore` | Quitado del `.gitignore` (con el porqué escrito ahí), y `legacy/package-lock.json` explícitamente excluido: `legacy/` es material congelado. El árbol instalado hoy es **electron 36.4.0** — el informe dice 36.9.5 en `H8` y 36.4.0 en `C2`; lo verificado contra `node_modules/electron/package.json` es 36.4.0. **Falta commitear el archivo** |
| 🟡 `M12` | Las flechas colisionan con el scrubber enfocado | `suppressesKey` (`use-global-shortcuts.ts`) pasa a ser consciente de **roles ARIA**, no solo de tagName: un elemento con `role="slider"` (y `listbox`, `option`, `combobox`, `menu*`, `tab*`, `tree*`, `grid`, `spinbutton`) consume las flechas igual que un `<button>`. Es la generalización de la regla que ya estaba en [`shortcut-suppression-must-be-per-key-not-per-focused-element.md`](../../.claude/knowledge/shortcut-suppression-must-be-per-key-not-per-focused-element.md) |
| 🟡 `M24` | `MediaScrubber` no maneja `pointercancel` | `onPointerCancel` **y** `onLostPointerCapture` limpian `dragSeconds`, sin cometer ningún seek: sin release no hay posición que el operador haya pedido |

**Verificación de esta tanda:** `npm run typecheck` ✅ · `npm run lint` ✅ (los mismos 5 warnings
preexistentes de react-refresh) · `npm run db:smoke` ✅ · `npm run build` ✅ · la app **se levantó
en dev** y el renderer cargó sin ninguna navegación bloqueada en el arranque · la regla de
origen+pathname de `will-navigate` se probó contra las formas de URL reales (dev-server con query
de HMR, `file://` empaquetado, el `file:///…/video.mp4` del caso de drop, `worship://`). **Lo que
sigue sin verificarse es el bug original de `C1`**: confirmar que un archivo soltado en el vacío
navegaba la ventana requiere arrastrar un archivo con la mano, y sigue siendo el primer ítem de
la checklist de §9.2.

Hallazgo registrado en
[`.claude/knowledge/a-file-dropped-outside-a-drop-zone-navigates-the-window-out-of-the-app.md`](../../.claude/knowledge/a-file-dropped-outside-a-drop-zone-navigates-the-window-out-of-the-app.md).

---

## 1.ter Dos bugs de campo que este informe NO tiene (2026-09-13, misma fecha)

Después de aplicar la Tanda 1, el usuario reportó **dos defectos que vio usando la app** y que no
están en las 76 filas de abajo — ni en las 54 de la cadena de media, ni en la de negro/logo. Se
verificó por búsqueda de síntoma (`toast`, `duplicad`, `blockedAssetId`) y de área (`transition`,
`crossfade`, `videoRole`) antes de darlos por nuevos. **Este informe no se reescribe para
incorporarlos** — es una foto del 2026-09-13 por lectura estática, y los dos se diagnosticaron
levantando la app. Viven en su propio informe:
[`2026-09-13-bugs-de-campo.md`](2026-09-13-bugs-de-campo.md).

| # | Severidad | Síntoma | Causa raíz |
|---|---|---|---|
| `F1` | 🟠 | Quitar un recurso de "Usados recientemente" muestra el mismo toast **4 veces** | `blockedAssetId` es un evento de un solo uso consumido en un `useEffect` de `MediaBrowser`, y `M43` de la auditoría anterior dejó **una instancia montada por pestaña visitada**. Medido: 5 paneles → 4 toasts, 2 paneles → 1 toast |
| `F2` | 🟠 | Video → video en el proyector **no hace la disolvencia**: pasa por negro | El único `<video>` montado en esa transición es el **entrante**, y `videoRole` le da el papel de **saliente**: reproduce el fade-out, se funde a negro y después salta a opacidad 1. Medido en la ventana de proyección: op 1,000 → 0,024 en 267 ms y salto a 1,000 a los 330 ms |

**Dónde entran en la §10:** `F2` opción (a) (una línea en `videoRole`) y `F1` opción (a) van a la
**Tanda 2**, sin desplazar a `H3`/`H2`/`H5`; `F2` opción (b) (la disolvencia real) va a la Tanda 3.

---

## 1.quater Estado — Tanda 2 aplicada (2026-09-14, décima sesión)

**6 hallazgos más cerrados de los 76** (`H1`, `H2`, `H3`, `H5`, `H6`, `H7`-la-otra-mitad), más
`M22`, `M27`, `M31` y `M16` que cayeron dentro del mismo trabajo, y los dos bugs de campo `F1` y
`F2` (en [su propio informe](2026-09-13-bugs-de-campo.md), §8). Total acumulado: **12 de 76 + los 2
de campo**. Todo verificado contra la app real por CDP y AppleScript, con la biblioteca y los
programas del usuario — los números de abajo son medidos.

| # | Hallazgo | Qué se hizo |
|---|---|---|
| 🟠 `H1` | Los modales no atrapan el foco, no lo ponen al abrir y no lo devuelven al cerrar | **Decisión del usuario: trap sobre el portal actual, no reescribir con `<dialog>` nativo** — la pila, el backdrop único y el Escape del de arriba funcionan y son sutiles. Se agregaron las cuatro piezas que faltaban: foco inicial al primer control (o al diálogo, que ya llevaba `tabIndex={-1}`), dos centinelas que envuelven el orden de tabulación, devolución del foco al elemento que abrió, e `inert` sobre `#root` — este último desde `modal-stack.ts`, en `pushModal`/`popModal`, para que esté puesto antes de que el diálogo corra su efecto de foco y sacado antes de que el que cierra devuelva el suyo. `Dialog` suma `aria-modal` y `aria-labelledby`, alimentado por un `ModalTitle` nuevo que toma el id por contexto. Efecto colateral necesario: `ToastHost` se portalea a `document.body`, o `inert` dejaría sus acciones ("Deshacer", "Eliminar igualmente") sin poder clickearse |
| 🟠 `H2` | Cerrar o recargar descarta el orden de culto sin guardar, sin preguntar | **Decisión del usuario: las tres capas.** (1) **Autoguardado**: tabla `program_draft` de una fila + `effects/draft-autosave.ts` con debounce de 600 ms; `App` lo recupera al arrancar. (2) **Menú propio** (`windows/app-menu.ts`): sin Ventana→Cerrar —lo que además cierra el ⌘W que bajaba el proyector, el `C1` de la feature #5— y con el bloque Recargar/Forzar recarga/DevTools solo en build de desarrollo. (3) **Guard de cierre** (`windows/close-guard.ts`): main veta el primer `close`, emite `close-requested` y espera un `window:closeDecision`, con 4 s de gracia para que un renderer colgado no vuelva la app incerrable. Main nunca infiere si hay trabajo sin guardar — eso es del control, por la regla de `CLAUDE.md` |
| 🟠 `H3` | Previsualizar un programa reasigna el programa actual de main | Canal `programs:peek` nuevo, de solo lectura, y `ProgramsRepo.peek()` separado de `load()` — el que estampa `lastOpenedAt`. Se eligió el canal propio sobre el `adopt?: boolean` que sugería el informe porque el `lastOpenedAt` hay que tocarlo igual en el repo, y así la intención queda escrita en el contrato en vez de en un booleano |
| 🟠 `H5` | El respaldo previo a una migración copia el `.db` sin el `-wal` | `VACUUM INTO` + `PRAGMA integrity_check` sobre la copia. `backupBeforeMigrate` devuelve un `BackupResult`, y el diálogo de error promete una copia **solo si de verdad la hay y pasó la verificación** — antes la prometía siempre |
| 🟠 `H6` | `settings:set` persiste cualquier clave con cualquier valor | `SETTINGS_VALIDATORS` junto a `DEFAULT_SETTINGS`, un predicado por clave, `Record<keyof SettingsMap, …>` para que una clave nueva sin validador no compile. El lote se rechaza entero con `INVALID_SETTING`, no se filtra: medio aplicar dejaría al renderer optimista en desacuerdo con la base sin que nadie lo vea, y `settings.store.update` ya relee de main ante un rechazo |
| 🟠 `H7` | La otra mitad del contraste del tema oscuro | Rampa `-ink` para los **cinco** tonos que aparecen como texto o ícono suelto (`danger`, `primary`, `success`, `warning`, `badge-audio`), más el salto de `--wa-text-muted` de `#7089a8` a `#92aac8`. Tabla completa y derivaciones en `docs/knowledge/06-ui-and-theme.md` |
| 🟡 `M22` | El tono `warning` usaba el token de PPT | Cayó solo: `Callout`/`Toast` pasan a `border-warning/40 bg-warning/10` + `text-warning-ink` |
| 🟡 `M27` | No se cierra la base al salir | `closeDatabase()` en `will-quit` con `wal_checkpoint(TRUNCATE)` + `close()` |
| 🟡 `M31` | `draftItems()` castea a `as never` | `toUpsertItems()`, un `switch` exhaustivo por `kind`. No era higiene: el autoguardado de `H2` depende de que ese tipo sea real |
| 🟡 `M16` | `ToastHost` devuelve `null` sin toasts | El contenedor queda siempre montado con `aria-live="polite"`. Entró junto con el portaleo que `H1` obligaba |

### Contraste — medido sobre los valores reales, tema oscuro, sobre `bg-card`

| | Antes | Ahora |
|---|---|---|
| `text-danger` (el aviso de `MediaTrackRow`) | 2,35 | **5,01** |
| `text-primary` | 2,83 | **5,94** |
| `text-success` | 2,83 | **5,58** |
| `text-badge-audio` | 2,85 | **5,52** |
| `text-warning` | 2,89 | **6,33** |
| `text-subtle` | 3,70 | **5,59** |

Las seis pasan AA de texto chico. **Queda abierto** un par que ninguna medición previa había mirado:
el tema **claro** roza el límite en `--wa-warning` sobre `bg-muted` (4,00) y `--wa-text-muted` sobre
`bg-muted` (4,22). No se tocó: subirlos mueve neutros de ALPS y colapsa la jerarquía contra
`--wa-text-secondary`, que es decisión de diseño.

### Verificación de esta tanda — corrida contra la app real

```
npm run typecheck   ✅     npm run lint   ✅ (los mismos 5 warnings de react-refresh)
npm run db:smoke    ✅ 18/18 (3 casos nuevos: borrador, validadores, respaldo WAL)
npm run build       ✅
```

| Qué | Cómo se midió | Resultado |
|---|---|---|
| `H1` trap | diálogo abierto desde la acción de un toast | 1 diálogo, `aria-modal="true"`, `aria-labelledby` → "¿Eliminar igualmente?", `#root` con `inert`, foco adentro, Tab desde el último vuelve al primero, Escape cierra y saca el `inert` |
| `H1` devolución | modal Programas abierto desde su botón | el foco vuelve **al mismo botón** |
| `H2` autoguardado | 3 ítems al programa → esperar el debounce | `program:loadDraft` → 3 ítems |
| `H2` recuperación | **reinicio completo de la app** | el programa vuelve con sus 3 filas y el badge "No guardado" |
| `H2` menú | `osascript … get name of menu items … "Ventana"` | `Minimizar, Zoom, (separador), Traer todo al frente` — **sin Cerrar** |
| `H2` ⌘W | tecla real por AppleScript | no cierra nada; la ventana sigue abierta |
| `H2` guard | ⌘Q real → Cancelar → ⌘Q otra vez → Cerrar igualmente | pregunta, se queda, **vuelve a preguntar**, y sale |
| `M27` | archivos tras salir | `worship.db-wal` y `-shm` **borrados** (firma de un `close()` limpio) — antes sobrevivían con 20 632 B |
| `H3` | `programs:peek` sobre un programa guardado | 9 ítems devueltos, `lastOpenedAt` **sin cambios** |
| `H6` | 4 payloads inválidos por IPC | los 4 rechazados con `INVALID_SETTING`; `"ui.theme": "dark"` aceptado; la base quedó limpia |
| `H5` | `db:smoke` 18/18 con un `-wal` caliente de 4,1 MB | `VACUUM INTO` 5000 filas · `copyFileSync` 4977 |

**Un defecto propio, encontrado y arreglado en la verificación:** el primer diseño del guard usaba
dos canales (`confirmClose`/`cancelClose`) y el "estoy preguntando" borraba la misma bandera global
de "esto era un quit" que la confirmación posterior necesitaba. Resultado: "Cerrar igualmente"
hacía `win.close()` en vez de `app.quit()`, el quit quedaba cancelado, `will-quit` nunca corría y
la base nunca se cerraba — con la app saliendo igual, así que no se veía. Se colapsó a un solo
`window:closeDecision` (`"close" | "hold" | "cancel"`) con la intención capturada en el `PendingClose`.
Registrado en
[`.claude/knowledge/vetoing-a-close-during-a-quit-cancels-the-quit.md`](../../.claude/knowledge/vetoing-a-close-during-a-quit-cancels-the-quit.md).

### Lo que esta tanda NO tocó

`C2` (Electron 36 EOL), `H4` ya estaba, `H8` ya estaba, `H9` (ESLint con tipos + a11y),
`M9`/`M10` (virtualizar las dos grillas), `M7`/`M8` (el N+1 de `ProgramsRepo`), y las decisiones de
producto `M1`/`M2`/`M3`/`M5`. La §10 de abajo sigue valiendo como orden para lo que queda.

---

## 2. Qué estaba cubierto y qué no

Reconstruido leyendo los dos informes previos y el índice, antes de decidir el alcance.

| Área | Estado previo | Esta auditoría |
|---|---|---|
| Pipeline de media (import→conversión→caché→serving→proyección) | ✅ transversal 2026-09-11, 5 sesiones | — no se re-audita |
| `SchedulePanel`, `ResourcePanel`, `media-browser`, `bible-browser` | ✅ transversal (features 1, 2, 3) | — |
| `slides/`, `deck-service`, `libreoffice`, `zip-reader`, `pptx-metadata` | ✅ transversal (feature 4) | — |
| Negro / Logo / En vivo, `playback.ts`, `projection.store`, `display.store` | ✅ `AUDIT-black-logo` (feature 5) | — |
| `worship-protocol`, `thumbnail-service`, `media.repo`, `slides.repo` | ✅ transversal | — |
| **`pages/monitors/` (7 archivos, 590 líneas)** | ⬜ **feature 7 sin auditar** | ✅ **cubierta** |
| **`pages/slides/` (3 archivos, 404 líneas)** | ⬜ **feature 8 sin auditar** | ✅ **cubierta** |
| **`pages/programs/` + `pages/settings/` (8 archivos)** | ⬜ **feature 9 sin auditar** | ✅ **cubierta** |
| **`components/ui/**` (29 primitivas) como sistema** | ⬜ nunca auditado | ✅ **cubierto** |
| **Accesibilidad (foco, ARIA, teclado, contraste)** | ⬜ nunca auditada | ✅ **cubierta y medida** |
| **i18n (`lib/i18n/`, `es.ts`)** | ⬜ nunca auditada | ✅ **cubierta y medida** |
| **Hardening de Electron (navegación, menú, ventanas)** | parcial (CSP ok) | ✅ **cubierto** |
| **Build, empaquetado y dependencias** | ⬜ nunca auditado | ✅ **cubierto** |
| **`programs.repo`, `history.repo`, `settings.repo`, `migrate.ts`** | ⬜ apenas rozados | ✅ **cubiertos** |
| **Código muerto y features sin cablear** | ⬜ nunca buscado | ✅ **barrido completo** |

---

## 3. Leyenda

| Símbolo | Severidad | Criterio |
|---|---|---|
| 🔴 | Bloqueante | Puede dejar la app inutilizable o la proyección caída durante un culto |
| 🟠 | Alto | Pérdida de datos, un aviso que el operador no puede leer, o una decisión invisible que lo perjudica |
| 🟡 | Medio | Defecto real, trabajo desperdiciado, o una regla del propio proyecto incumplida |
| 🔵 | Bajo | Higiene, consistencia, deuda acotada |
| ⚪ | Info | Observación sin acción inmediata, o una decisión deliberada que conviene dejar por escrito |

---

## 4. 🔴 Bloqueantes

### `C1` — Soltar un archivo fuera de una zona de drop navega la ventana de control fuera de la app

- **Dónde:** ausencia de handler a nivel documento en `src/renderer/src/main.tsx` y
  `src/renderer/src/projection.tsx`; ausencia de guards en `src/main/windows/control-window.ts:10`
  y `src/main/windows/projection-window.ts:23`.
- **El problema:** sólo dos elementos del árbol llaman `preventDefault` sobre `dragover`/`drop` —
  `SchedulePanel.tsx:167` y `media-browser.tsx:313`. Todo lo demás (la `TopBar`, la columna central,
  la columna de monitores, los separadores, cualquier hueco del layout) deja pasar el evento al
  comportamiento por defecto de Chromium, que para un archivo reconocido es **navegar el documento
  a ese archivo**. La ventana de control deja de existir como aplicación: el árbol de React se va,
  las suscripciones IPC se van, y el `program.store` con el orden de culto sin guardar se va con
  ellos (ver `C2`/`H2`). La única salida es reiniciar.
- **Por qué no lo detiene nada de lo que ya hay:** la CSP (`default-src 'self'`) **no gobierna la
  navegación de nivel superior** — la directiva que lo hacía (`navigate-to`) se retiró de la
  especificación. `webSecurity: true` tampoco: no es una violación de seguridad, es una navegación
  normal. Y el menú por defecto de Electron ni siquiera ofrece "atrás".
- **El agravante:** esta app es de arrastrar y soltar por diseño. El operador arrastra archivos
  desde Finder/Explorador todo el tiempo; soltar 30 px fuera del panel de recursos es el error
  natural, no el exótico.
- **Verificación pendiente:** el razonamiento es por lectura (`grep` de `dragover`/`drop` sobre
  todo `src/renderer`, cero handlers a nivel `document`/`window` fuera de los dos citados). **No se
  ejecutó la app para confirmar la navegación**, porque esta auditoría es estática; es la primera
  prueba de la checklist de §9.
- **Cómo se resuelve (documentado por Electron y por Quasar como el patrón estándar):** las tres
  capas, no una.
  ```ts
  // main, por ventana — la red de seguridad que no depende del renderer
  win.webContents.on("will-navigate", (e, url) => { if (url !== expectedUrl) e.preventDefault(); });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  ```
  ```ts
  // renderer, una vez por entry — lo que evita la navegación en origen
  for (const type of ["dragover", "drop"]) {
    document.addEventListener(type, (e) => e.preventDefault());
  }
  ```
  Las zonas de drop reales siguen funcionando: llaman `preventDefault` antes y su handler corre
  igual; lo que se neutraliza es el default del documento.

### `C2` — Electron 36 está en fin de vida: sin parches de seguridad

- **Dónde:** `package.json` → `"electron": "^36.4.0"`; instalado **36.4.0**; línea publicada
  actual **44.3.0**.
- **El problema:** Electron mantiene las últimas tres líneas estables. La 36 quedó fuera de esa
  ventana hace varias líneas, y cuando una versión llega a EOL **los mantenedores dejan de emitir
  parches de seguridad** — incluidos los de Chromium, que es el que decodifica todo lo que esta app
  le da de comer. Y le da de comer cosas que vienen de afuera: video y audio arbitrarios del
  operador (`<video>`/`<audio>` sobre `worship://`), imágenes, PDFs a través de pdf.js en la ventana
  rasterizadora, JSON de Biblia importado, y ZIPs (`.pptx`) que se leen entrada por entrada. Cada
  uno de esos es un decoder, y los decoders son donde aparecen los CVE de Chromium.
- **Agravado por `H8`:** sin lockfile, `^36.4.0` resuelve hoy a **36.9.5** y mañana a otra cosa. Ni
  siquiera se sabe con certeza qué Electron corre en la máquina del operador.
- **Cómo se resuelve:** subir a una línea soportada. No es gratis — hay que revalidar
  `webUtils.getPathForFile`, el preload CJS forzado en `electron.vite.config.ts`, los prebuilds
  N-API de `better-sqlite3` y el ciclo de vida de las dos ventanas. Es exactamente el tipo de
  trabajo que conviene hacer **fuera** de la temporada de cultos, y por eso está acá y no en la
  lista de "cuando haya tiempo". Conviene acompañarlo de `electron-builder` 25→26 y `electron-vite`
  3→5, que son los otros dos escalones grandes (§8).

---

## 5. 🟠 Altos

### `H1` — Los modales no atrapan el foco, no lo ponen al abrir y no lo devuelven al cerrar

- **Dónde:** `src/renderer/src/components/shared/modal/Modal.tsx:72-96`,
  `src/renderer/src/components/ui/dialog.tsx:6`.
- **El problema:** `Modal` hace bien las dos cosas difíciles (pila de modales, un solo backdrop,
  Escape sólo para el de arriba) y ninguna de las cuatro básicas:
  1. **No hay focus trap.** Tab sale del diálogo y sigue recorriendo la app de fondo — la
     `TopBar`, los tres paneles, la grilla virtualizada entera. El operador puede terminar
     apretando Enter sobre EN VIVO creyendo que confirma un diálogo.
  2. **No se enfoca nada al abrir.** `Dialog` lleva `tabIndex={-1}` pero nadie llama `.focus()`,
     así que el foco se queda donde estaba: en el botón que abrió el modal, detrás del backdrop.
  3. **No se devuelve el foco al cerrar.** Termina en `<body>`, y el siguiente Tab arranca desde
     el principio del documento.
  4. **El fondo no queda inerte**: ni `inert`, ni `aria-hidden`, ni bloqueo de scroll del body.
- **Además:** `Dialog` pone `role="dialog"` pero no `aria-modal="true"` ni `aria-labelledby`
  apuntando al `<Title>` que todos los modales ya tienen. Un lector de pantalla no anuncia de qué
  diálogo se trata.
- **El atajo global se salva por otro camino, no por éste:** `useGlobalShortcuts(useAnyModalOpen())`
  suspende B/L/Supr/Enter mientras haya un modal abierto. Eso está bien resuelto y evita el peor
  escenario (escribir el nombre de un programa y mandar el proyector a NEGRO con la "b"). Pero no
  sustituye al trap: el foco sigue pudiendo salir y activar botones.
- **Cómo se resuelve:** en 2026 la recomendación estándar es **`<dialog>` nativo con
  `showModal()`**, que da trap de foco real del navegador, Escape, backdrop y semántica ARIA sin
  una línea de JS de foco. Encaja con la regla del proyecto de no meter Radix: es plataforma, no
  dependencia. La alternativa, si se quiere conservar el portal actual, es sentinelas de foco +
  `inert` sobre `#root`.

### `H2` — Cerrar o recargar la ventana de control descarta el orden de culto sin guardar, sin preguntar

- **Dónde:** `src/renderer/src/stores/program.store.ts` (estado sólo en memoria),
  `src/main/index.ts:99` (`win.on("closed")` no consulta nada), ausencia de `beforeunload` en todo
  el renderer, ausencia de `Menu.setApplicationMenu` en todo `src/main`.
- **El problema:** el orden de culto en edición vive exclusivamente en `program.store.items`.
  `hasUnsavedChanges()` existe y se consulta **sólo** en los flujos internos (abrir otro programa,
  "nuevo programa", el panel `discard` del modal). Ningún camino del sistema operativo pasa por
  ahí:
  - **⌘R / Ctrl+R** recarga el renderer → el store se reinicia vacío. El menú por defecto de
    Electron lo ofrece (View → Reload y Force Reload), porque `setApplicationMenu` no se llama nunca.
  - **⌘W / cerrar la ventana** → `openControlWindow`'s `closed` cierra el proyector y sale; nadie
    pregunta.
  - Un crash del renderer, o `C1`, producen lo mismo.
- **Por qué duele:** armar el orden de un culto son 15–40 minutos de trabajo del operador, hecho
  normalmente **antes** del servicio, con la app abierta durante horas. Es el único dato de la app
  que no está respaldado por SQLite mientras se edita.
- **Cómo se resuelve, en capas:**
  1. `window.addEventListener("beforeunload", e => { if (hasUnsavedChanges()) e.preventDefault(); })`
     — cubre ⌘R y el cierre desde el renderer.
  2. En main, `win.on("close", e => …)` con un `dialog.showMessageBox` si el renderer reporta
     cambios sin guardar (hace falta un canal nuevo, o consultarlo por `executeJavaScript`).
  3. `Menu.setApplicationMenu(...)` con un menú propio: quitar Reload/Force Reload/DevTools de la
     build empaquetada resuelve además la mitad de `M20`, y quitar Window→Close del menú es lo que
     cierra el `C1` del informe de la feature #5 (⌘W sobre el proyector).
  4. Lo verdaderamente robusto: **autosave del borrador** en una fila de `settings` o una tabla
     propia cada N segundos, y recuperarlo al arrancar. Es lo que hace EasyWorship y es lo único
     que sobrevive a un corte de luz.

### `H3` — Previsualizar un programa en el modal reasigna el "programa actual" del proceso main

- **Dónde:** `src/renderer/src/components/pages/programs/program-side-panel.tsx:127`
  (`api.programs.load(mode.program.id)` en modo `preview`) →
  `src/main/ipc/handlers/programs.ts:54` (`"programs:load": ({id}) => adoptProgram(...)`) →
  `adoptProgram` (líneas 31-39).
- **El problema:** en el modal de programas, **un solo clic** sobre una fila abre el panel lateral
  en modo `preview`, que carga el programa completo para mostrar su lista de ítems. Ese canal no es
  de sólo lectura: `adoptProgram` hace tres cosas con efecto en el proceso main.
  1. `setCurrentProgramId(program.id)` → **todas las filas de `projection_history` escritas de ahí
     en adelante se atribuyen al programa que el operador apenas miró**, no al que está abierto.
  2. `pinDecks("program", [...])` → **los pines anti-desalojo se mueven a los decks del programa
     previsualizado**, y los del culto realmente abierto pasan a ser candidatos normales de LRU. El
     comentario del propio archivo dice para qué existe ese pin: *"un deck sentado en el orden de
     servicio abierto era desalojable a mitad de culto, exactamente lo que el pin existe para
     evitar"*. Previsualizar lo reintroduce.
  3. `ProgramsRepo.load()` escribe `lastOpenedAt = Date.now()` (línea 79-83) en un programa que no
     se abrió.
- **Y el renderer no se entera:** `program.store.currentProgramId` no cambia. Main y renderer
  quedan en desacuerdo sobre cuál es el programa actual, que es justamente el tipo de segunda
  fuente de verdad que `CLAUDE.md` prohíbe.
- **Lo que lo enmascara:** la gracia de 24 h de `evictIfOverCap` — con la caché por debajo del tope
  no se desaloja nada y no se nota. Se nota el domingo en que la caché está llena.
- **Cómo se resuelve:** separar la lectura de la adopción. O un canal `programs:peek` de sólo
  lectura para el panel de vista previa, o un `adopt?: boolean` en el request de `programs:load`
  (por defecto `true`, que el panel pasa en `false`). La segunda opción es una línea en el contrato
  y una en el handler.

### `H4` — `Supr`/`Retroceso` borra un recurso de la biblioteca sin ninguna confirmación

- **Dónde:** `src/renderer/src/lib/hooks/use-global-shortcuts.ts:70-73` →
  `lib/actions/remove-selected.ts:10` → `lib/actions/remove-asset.ts:41`. El botón de papelera de
  `media-browser.tsx:429` toma el mismo camino.
- **El problema:** la confirmación existe (`RemoveAssetConfirm`) pero **está sólo en el camino
  forzado**, es decir, cuando el borrado falla porque un programa guardado usa el recurso. La
  consecuencia es al revés de lo intuitivo:
  - recurso **no** usado por ningún programa → se borra en el acto, sin preguntar, con una tecla;
  - recurso **sí** usado → se bloquea y aparece un diálogo de confirmación.
  El caso peligroso es el que no pregunta.
- **Atenuante real, que baja esto de bloqueante a alto:** `removeMediaAsset` (main) borra **filas de
  la base, no el archivo del disco**. El daño es "desapareció de la biblioteca", recuperable
  volviendo a importar — pero se pierden `inLibrary`, el audio vinculado, el hash de contenido y la
  asociación con el deck ya convertido (que pasa a ser huérfano hasta el próximo barrido).
- **Agravante:** `Supr`/`Retroceso` no se suprimen sobre un `<button>` enfocado (decisión correcta y
  documentada en `suppressesKey`), así que se disparan en prácticamente cualquier estado de foco
  mientras haya un recurso seleccionado.
- **Cómo se resuelve:** confirmar siempre, o —mejor para una cabina— borrar de inmediato y ofrecer
  un **toast con "Deshacer"**. El store de toasts ya soporta acciones que no auto-descartan
  (`durationMs: null` cuando hay `action`), así que la pieza ya está construida.

### `H5` — El respaldo previo a una migración copia el `.db` sin el `-wal`

- **Dónde:** `src/main/db/migrate.ts:74` — `fs.copyFileSync(dbFilePath, dest)`.
- **El problema:** la base se abre con `journal_mode = WAL` (`db/client.ts:15`). En WAL, **las
  transacciones recientes viven en `worship.db-wal`, no en `worship.db`**. Copiar sólo el archivo
  principal produce un respaldo al que le faltan, en silencio, todas las escrituras posteriores al
  último checkpoint — y la documentación de SQLite es explícita al respecto: copiar el archivo de
  una base en WAL con herramientas de sistema de archivos no es un respaldo válido.
- **Por qué importa más que en otros lados:** ésta es *la* ruta de recuperación ante desastres. El
  comentario del propio archivo lo dice: *"una migración que falla en la máquina de un usuario un
  domingo a la mañana tiene que ser recuperable"*. Un respaldo incompleto es peor que ninguno,
  porque se restaura con confianza.
- **Cuándo se materializa:** `backupBeforeMigrate` corre **antes** de que la app abra la base, así
  que normalmente el WAL está checkpointeado y la copia sale completa. Falla justo cuando hay que
  contar con ella: tras un cierre sucio, un corte de luz o un SIGKILL — que es exactamente el
  escenario que deja un `-wal` grande y no checkpointeado. Y `M27` (no se cierra la base al salir)
  hace ese escenario más probable, no menos.
- **Cómo se resuelve:** usar un mecanismo consciente del WAL. Dos opciones, ambas seguras sobre una
  base viva:
  - `sqlite.backup(dest)` — la API de respaldo en línea de `better-sqlite3` (envuelve
    `sqlite3_backup`), que propaga las páginas que cambian mientras corre;
  - `VACUUM INTO 'dest'` — produce además una copia compactada y desfragmentada (requiere SQLite
    ≥ 3.27, ampliamente satisfecho por el `better-sqlite3` 13 de este proyecto).
  En ambos casos conviene rematar con `PRAGMA integrity_check` sobre la copia antes de darla por
  buena: un respaldo no verificado es una suposición.

### `H6` — `settings:set` persiste cualquier clave con cualquier valor

- **Dónde:** `src/main/ipc/handlers/settings.ts:6` → `db/repositories/settings.repo.ts:47-61`.
- **El problema:** `setMany` itera `Object.entries(partial)` y hace un `INSERT … ON CONFLICT` por
  cada par, **sin comprobar que la clave pertenezca a `SettingsMap` ni que el valor tenga el tipo
  declarado**. El único guard que hay (`if (key in current)`, línea 59) protege la *caché en
  memoria*, no la escritura: la fila entra igual en la tabla.
- **Por qué el tipo no alcanza:** `SettingsMap` se borra en el build. `registerHandlers`
  (`ipc/register.ts:27`) castea `req: unknown` a la firma declarada y llama. El renderer es otro
  proceso: un bundle viejo tras una actualización parcial, un bug en `library-folders.ts`
  construyendo mal un `Record`, o cualquier `update({...})` con una clave mal escrita escribe basura
  duradera que ninguna migración va a limpiar.
- **Consecuencias concretas y baratas de producir:** `"ui.theme": "purple"` se persiste, se lee al
  arrancar, se escribe en `document.documentElement.dataset.theme` y **la app queda sin ningún tema
  aplicado** — ni oscuro ni claro — hasta que alguien edite la base a mano.
  `"projection.displayId": "2"` (string) nunca vuelve a coincidir con ningún `d.id` numérico y el
  proyector siempre cae al display por defecto.
- **Este es el caso general del hallazgo, no la excepción:** **ningún handler de main valida su
  payload.** `settings:set` es el que más duele porque escribe estado duradero, pero el patrón —
  contrato tipado sin validación en runtime — es transversal.
- **Cómo se resuelve:** un validador por clave en el borde IPC. No hace falta traer Zod para esto:
  `DEFAULT_SETTINGS` ya enumera todas las claves y sus tipos, así que un
  `Record<keyof SettingsMap, (v: unknown) => boolean>` junto a él cubre el 100 % y se queda sin
  dependencias nuevas, en la línea del resto del proyecto. Rechazar con
  `IpcError({code: "INVALID_SETTING"})`.

### `H7` — El contraste del tema oscuro falla WCAG en casi todo el color, incluido el aviso de error

- **Dónde:** `src/renderer/src/components/ui/badge.tsx:6-16` (la fórmula), y en general todo texto
  de color sobre `bg-card`/`bg-surface`. Tokens en `styles/globals.css:106-131`.
- **El problema medido.** La fórmula del `Badge` es `bg-<color>/20` + `text-<color>`: **tinte y
  texto del mismo tono**, que es el anti-patrón clásico de contraste. Calculado sobre los valores
  reales, con la composición alfa resuelta:

  | Elemento | Ratio | AA (4,5:1) | AA grande / UI (3:1) |
  |---|---|---|---|
  | `Badge variant="video"` sobre `bg-card` | **2,18** | ❌ | ❌ |
  | `Badge variant="bible"` sobre `bg-card` | **2,31** | ❌ | ❌ |
  | `Badge variant="audio"` sobre `bg-card` | **2,33** | ❌ | ❌ |
  | `Badge variant="image"` sobre `bg-card` | **2,38** | ❌ | ❌ |
  | `Badge variant="ppt"` sobre `bg-card` | **2,59** | ❌ | ❌ |
  | `Badge variant="blue"` (el del encabezado) sobre `bg-surface` | **3,08** | ❌ | ✅ |
  | **`text-danger` sobre `bg-card`** — el error de `MediaTrackRow` | **2,35** | ❌ | ❌ |
  | `text-primary` sobre `bg-card` — el enlace "resincronizar" de `DeckTransport` | **2,83** | ❌ | ❌ |
  | `text-badge-audio` sobre `bg-card` — el ícono de pista de audio | **2,85** | ❌ | ❌ |
  | `text-subtle` sobre `bg-card` — los relojes y los `hint` de `MediaTrackRow` | **3,70** | ❌ | ✅ |
  | `text-subtle` sobre `bg-surface` | 4,72 | ✅ | ✅ |
  | `text-foreground` sobre `bg-background` | 17,00 | ✅ | ✅ |
  | `text-muted-foreground` sobre `bg-background` | 9,95 | ✅ | ✅ |
  | Blanco sobre `bg-primary` / `bg-success` / `bg-danger` (botones) | 4,71 / 4,71 / 5,67 | ✅ | ✅ |

  (Fórmula WCAG 2.x estándar; el cálculo completo quedó en `.scratch/audit/`. El tema **claro**
  pasa holgadamente en todos los pares equivalentes — 7,7 a 8,2 — así que esto es específicamente
  del tema oscuro, que es el por defecto y el de cabina.)

- **El caso que convierte esto en un hallazgo alto y no en uno de estilo:** `text-danger` a
  **2,35:1** es el texto de `media.loadErrorRow` en `MediaTrackRow` (`media-track-row.tsx:178`), el
  aviso de que **un archivo no se está reproduciendo en el proyector**. La regla del proyecto es que
  ese aviso sólo lo ve el operador y nunca la congregación; el corolario es que el operador tiene
  que poder leerlo — a oscuras, de reojo, en `text-xs`, a 2,35:1.
- **Los botones están bien.** Lo que falla es sistemáticamente el patrón "color sobre tinte del
  mismo color".
- **Cómo se resuelve — medido, no estimado.** Conservando exactamente el mismo tinte de fondo y
  cambiando sólo el color del texto a `text-foreground`:

  | Badge | Ahora | Con `text-foreground` |
  |---|---|---|
  | ppt | 2,59 | **13,51** |
  | video | 2,18 | **13,84** |
  | image | 2,38 | **12,85** |
  | audio | 2,33 | **12,57** |
  | bible | 2,31 | **12,52** |

  El color sigue codificando el tipo de contenido (que es para lo que existe el token), y el texto
  pasa a ser legible. Para `text-danger`/`text-primary`/`text-subtle` sobre `bg-card` hace falta lo
  otro que recomienda la guía de contraste en modo oscuro: **una rampa "on-dark" por tono** —
  redefinir `--wa-danger`, `--wa-accent-primary` y `--wa-text-muted` **sólo dentro del bloque
  `[data-theme="dark"]`** hacia versiones más claras del mismo hue. Es un cambio contenido a
  `globals.css` que ningún componente nota, que es justamente para lo que el sistema de tokens está
  montado.

### `H8` — `package-lock.json` está en `.gitignore`: los builds no son reproducibles

- **Dónde:** `.gitignore:9`; confirmado con `git ls-files package-lock.json` → vacío.
- **El problema:** todas las dependencias están declaradas con rango `^`. Sin lockfile versionado,
  cada `npm install` —en otra máquina, en el futuro, o tras un `rm -rf node_modules`— resuelve un
  árbol distinto. Hoy mismo `"electron": "^36.4.0"` resuelve a **36.9.5**, no a 36.4.0: **el
  binario de Electron que corre no es el que dice el `package.json`**.
- **Por qué acá pesa más que en un proyecto web:** hay un módulo nativo (`better-sqlite3`) cuyos
  prebuilds N-API están atados a versiones concretas, un empaquetador que decide qué entra en el
  `.asar`, y un binario de Electron que define la versión de Chromium que decodifica media del
  usuario. Un instalador construido dos veces puede no ser el mismo instalador, y un bug reportado
  por el operador puede no ser reproducible en la máquina de desarrollo.
- **Cómo se resuelve:** sacar la línea del `.gitignore`, commitear el lockfile y usar `npm ci` para
  construir releases. Es una de las correcciones más baratas de todo este informe y la que más
  incertidumbre elimina.

### `H9` — ESLint no tiene reglas con información de tipos ni de accesibilidad

- **Dónde:** `eslint.config.js:9` — `...tseslint.configs.recommended` (la variante **sin** tipos).
- **El problema:** el proyecto es estricto en TypeScript (`noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`) y laxo en el linter, que es justo donde viven las reglas que
  importan para este estilo de código:
  - **`@typescript-eslint/no-floating-promises`** — el proyecto llama IPC como `void api.algo()` en
    unos cuarenta lugares. Esa es una decisión deliberada y documentada, pero la regla es lo único
    que distingue un `void` intencional de un `await` olvidado. Hoy nada los distingue.
  - **`no-misused-promises`** — un `async` pasado como handler de evento o en un `if` no lo marca
    nadie.
  - **`await-thenable`, `require-await`, `no-unnecessary-condition`** — íd.
  - **`eslint-plugin-jsx-a11y`** — no está instalado, y explica por qué `H1`, `M12`, `M14` y `M15`
    llegaron hasta acá sin que nada chillara: un `onKeyDown` en un `<div>` sin `role`, un `slider`
    sin nombre accesible y un `role="dialog"` sin `aria-modal` son exactamente lo que esa regla
    encuentra.
- **La contrapartida honesta:** las reglas con tipos son notablemente más lentas. La recomendación
  de typescript-eslint es adoptarlas igual y usar comentarios de desactivación puntuales donde el
  patrón sea deliberado — que es precisamente el caso de los `void api.*` de este proyecto.
- **Cómo se resuelve:** `tseslint.configs.recommendedTypeChecked` con `parserOptions.projectService`
  para `src/**`, más `eslint-plugin-jsx-a11y` sobre `src/renderer/**`. Se puede escalonar: primero
  a11y (barato, sin tipos), después las de tipos.

---

## 6. 🟡 Medios

### 6.1 Features cableadas sin punto de entrada

| # | Hallazgo |
|---|---|
| `M1` | **`library:relocate` no tiene ningún call site.** Contrato (`contract.ts:132`), handler (`library.ts:38`), repo (`media.repo.ts:486`), fachada (`api.ts:62`) y hasta la cadena i18n `library.relocate: "Relocalizar…"` existen; `grep` no encuentra un solo consumidor en la UI. Consecuencia práctica: **un archivo faltante (`missingSince !== null`) no tiene camino de recuperación** — `PreviewMissingState` informa el problema y no ofrece la solución que ya está construida. |
| `M2` | **No hay control de volumen en ninguna parte.** `settings["media.volume"]` existe con default `0.5` y **nunca se lee**. `MediaCommand` tiene `action: "setVolume"` y `ProjectionApp.tsx:181` lo aplica correctamente — pero **nadie lo emite nunca** (`grep 'action: "volume"'`/`setVolume` → cero emisores). Para una app que manda audio a la PA de un templo, no poder bajar la banda sonora de un deck sin tocar la consola es un hueco real. La pieza cara (el comando llegando al elemento correcto del proyector) ya está hecha; falta el control. |
| `M3` | **Los ítems de programa `kind: "text"` no se pueden crear.** Existen en `schema.ts` (`textBody`), en `ProgramItemDTO`/`ProgramItemUpsert`, en `ProgramsRepo.toRow`/`toItemDTO`, en `usePreviewContent`, en `SlidesPanel` (renderiza su tile), en `selectOutput` y en `goLiveWithScheduleItem`. Los tres `addItem(...)` de la UI sólo construyen `media`, `ppt` y `bible`. **No hay forma de poner un anuncio de texto en el orden de culto** salvo hacer un PPT. |
| `M4` | `api.deck.progress` (`api.ts:38`) no tiene consumidor: el progreso llega por el evento `deck-progress`. Canal y fachada muertos. |
| `M5` | Ajustes no expone `slides.cacheMaxMb`, `slides.maxRenderWidth`, `slides.imageFormat` ni el **tamaño actual de la caché de diapositivas ni forma de vaciarla**. `cacheUsage()` ya calcula `bytesOnDisk`/`maxBytes` para el presupuesto de prewarm. El operador no tiene visibilidad ni control sobre lo que más crece en su disco. |
| `M6` | **28 claves de i18n definidas y nunca usadas** (medido, §7): `app.title`, `bible.addToList`, `bible.showChapter`, `bible.title`, `bible.version`, `deck.evicted`, `deck.notLive`, `deck.title`, `library.files`, `library.relocate`, `media.startAt`, `media.title`, `preview.placeholderHint`, `preview.title`, `programs.previewOpenHint`, `programs.saveAs`, `resources.title` y 11 más que sí se usan por clave dinámica. Varias son la huella de features retiradas a medias. |

### 6.2 Rendimiento

| # | Hallazgo |
|---|---|
| `M7` | **`ProgramsRepo.list()` es N+1.** `programs.repo.ts:66-74`: un `SELECT count(*)` por cada programa, dentro del `map`. Con 40 programas guardados son 41 consultas — y `list()` se ejecuta al abrir el modal, tras cada guardado, tras cada borrado, tras cada cambio de favorito y **dentro de `reorder()`, después de cada arrastre**. Un `LEFT JOIN … GROUP BY` lo deja en una. |
| `M8` | **`reorder()` emite un `UPDATE` por id** (línea 236) y después llama `list()` → `1 + n + (1 + n)` sentencias por arrastre. Una sola sentencia con `CASE WHEN` (o un `json_each` sobre el array de ids) lo resuelve. |
| `M9` | **`LiveContentGrid` renderiza todos los versículos del capítulo sin virtualizar** (`live-content-grid.tsx:45`). Salmo 119 son **176 `ThumbTile`**, cada uno un `<button>` con su propio estado. Lo mismo en `SlidesPanel.tsx:46` para el capítulo en preview: **dos grillas completas del mismo capítulo montadas a la vez**. `VirtualGrid` ya existe y resuelve esto en el panel de recursos. |
| `M10` | **`LiveContentGrid` y `DeckSlides` renderizan todas las diapositivas de un deck sin virtualizar.** Un himnario de 52 diapositivas está bien; los decks de 200–400 que el pipeline admite montan 400 tiles con 400 `<img>` cada uno — otra vez, dos veces (grilla en vivo + grilla de preview). |
| `M11` | `sceneContentKey` (`output-view.tsx:56`) hace `JSON.stringify` del output completo **en cada render de cada `OutputView`**, y hay tres instancias vivas. Es barato por instancia, pero es serialización en el camino de render de la ventana de proyección. Un comparador estructural sobre los pocos campos que importan evita el string. |

### 6.3 Accesibilidad y teclado

| # | Hallazgo |
|---|---|
| `M12` | **Las flechas colisionan cuando el scrubber tiene el foco.** `MediaScrubber` es un `<div role="slider" tabIndex={0}>` con su propio `onKeyDown` (flechas = seek ±5 s). `suppressesKey` (`use-global-shortcuts.ts:39`) sólo suprime flechas sobre `BUTTON`/`A`, así que un `DIV` no las suprime: **ArrowRight sobre el scrubber enfocado busca 5 segundos adelante Y avanza la diapositiva en vivo**, en el mismo keypress. Igual con ↑/↓ (seek + mover el cursor de preview). Arreglo: `role="slider"` (y `role="listbox"`, `role="tab"`…) en la lista de lo que consume flechas, o `e.stopPropagation()` en el handler del scrubber. |
| `M13` | **Callejón sin salida de teclado en la grilla central.** `ThumbTile` es un `<button>`, así que las flechas quedan suprimidas por `suppressesKey` — pero `SlideGrid` (a diferencia de `VirtualGrid`) **no implementa navegación por flechas**. Con una diapositiva o un versículo enfocado, ↑↓←→ **no hacen absolutamente nada**: ni navegan la grilla ni mueven el preview. |
| `M14` | `MediaScrubber` no tiene nombre accesible (`aria-label`/`aria-labelledby`), y su `aria-valuenow` es el **porcentaje**, no los segundos: un lector de pantalla anuncia "37" sin unidad ni contexto. Falta `aria-valuetext` con el reloj. Mismo problema en `ProgressBar`. |
| `M15` | `Dialog` (`dialog.tsx:6`) declara `role="dialog"` sin `aria-modal="true"` ni `aria-labelledby`. Todos los modales ya tienen un `<Title as="h3">` al que apuntar. |
| `M16` | `ToastHost` devuelve `null` cuando no hay toasts (`toast.tsx:60`), así que **la región viva nace junto con su contenido**. Los lectores de pantalla suelen no anunciar el contenido insertado en una región `aria-live` creada en el mismo tick. El contenedor debe estar siempre montado (vacío) con `aria-live="polite"`. |
| `M17` | `body { user-select: none }` (`globals.css:221`) es global y **no hay ni una sola utilidad `select-text` en todo el renderer**. Nada es seleccionable: ni una referencia bíblica, ni la ruta completa de un archivo en un tooltip, ni `error.message` en la pantalla de crash del `ErrorBoundary` — que es precisamente lo que el operador necesitaría copiar para reportar el problema. |
| `M18` | `ProgramSidePanel` ata `onKeyDown` (Escape/Enter) a un `<div>` sin `role` ni `tabIndex` (`program-side-panel.tsx:195`). Funciona por burbujeo desde los hijos enfocados; con el foco fuera del panel, Escape no llega. |

### 6.4 Sistema de componentes (reglas del propio proyecto incumplidas)

| # | Hallazgo |
|---|---|
| `M19` | **Falta la primitiva "botón de enlace", y ya se escribió tres veces a mano.** `deck-transport.tsx:120` (`text-primary hover:underline`), `ProgramsModal.tsx:355` (`text-sm font-medium underline`) y `toast.tsx:40` (`text-primary hover:underline`) son tres `<button>` crudos con clases de color y tipografía escritas a mano. `CLAUDE.md` es explícito: *"si algo visual se repite en dos features → sube a `components/ui/`"*. Corresponde `<Button variant="link">`. |
| `M20` | **`<textarea>` con estilos a mano** en `program-side-panel.tsx:249`: ocho clases de borde, fondo, radio, tipografía y anillo de foco copiadas de `Input`. Falta una primitiva `Textarea` en `components/ui/`. |
| `M21` | **No hay escala de z-index.** `globals.css` define con cuidado una escala de elevación de tres niveles para sombras y **ninguna para el apilado**: `z-10` (tooltip CSS), `z-50` (modal), `z-[60]` (toasts), `z-[100]` (menú de `Select`, tooltip flotante **y** el clon de arrastre de `ProgramsModal`). Tres cosas distintas compiten en el mismo nivel arbitrario y el orden real lo decide el orden del DOM. Corresponden tokens `--z-*` junto a `--shadow-*`. |
| `M22` | **El token semántico `warning` existe y el UI de advertencia usa el token de tipo de contenido.** `Callout` tone `warning` (`callout.tsx:20,26`) y el toast `warning` (`toast.tsx:8,22`) usan `badge-ppt` — el color reservado por la tabla de `CLAUDE.md` para "esto es un PowerPoint". `--color-warning` está definido en `globals.css:184` con el mismo valor y nadie lo usa. Hoy coinciden; el día que el naranja de PPT cambie, todas las advertencias de la app cambian con él. |
| `M23` | `ProgramsModal` define su propia `normalize()` (`ProgramsModal.tsx:33`) duplicando `normalizeForSearch()` de `lib/utils.ts:51`, con el rango de diacríticos escrito como literales combinantes crudos en la regex (ilegible y frágil al copiar/pegar). Una sola función, y `/\p{Diacritic}/gu` o `/[̀-ͯ]/g`. |

### 6.5 Corrección

| # | Hallazgo |
|---|---|
| `M24` | **`MediaScrubber` no maneja `pointercancel`.** `handlePointerUp` es lo único que limpia `dragSeconds` (`media-scrubber.tsx:200`). Si el puntero se cancela a mitad del arrastre (gesto del sistema, pérdida de foco, cambio de ventana), `dragSeconds` queda no nulo para siempre: la barra **sigue al cursor sin ningún botón apretado** y nunca vuelve a pintar la posición reportada. Falta `onPointerCancel={() => setDragSeconds(null)}`. |
| `M25` | **`useLiveStatus` dice "Sin señal" mientras el proyector muestra el LOGO.** `MonitorsColumn.tsx:36` devuelve `t("live.noSignal")` cuando `base === null`, pero `selectOutputWithoutUnderlay` (`projection.store.ts:249`) devuelve `{kind:"logo"}` en ese mismo caso. El escenario del monitor LIVE muestra el logo y la insignia de al lado dice que no hay señal. Es el invariante de "los monitores nunca le mienten al operador" aplicado a la insignia en vez de al escenario. |
| `M26` | **`useMediaAsset` puede desalojar una entrada que un componente montado sigue leyendo.** La caché módulo-global tiene tope `MAX_CACHED = 500` (`use-media-asset.ts:8`) y expulsa por antigüedad de inserción. El valor de retorno se lee **de la caché durante el render**, y el efecto sólo se dispara cuando cambia `id`. Con una biblioteca de 1.200+ decks y una grilla virtualizada que resuelve cientos de assets, una fila del programa puede perder su nombre y **no volver a pedirlo nunca**. Falta un contador de referencias, o marcar como recientemente usada la entrada en cada lectura (LRU real en vez de FIFO). |
| `M27` | **No se cierra la base al salir.** `before-quit` (`index.ts:202`) sólo llama `shutdownSlides()`. Sin `sqlite.close()` no hay checkpoint, y el `-wal` crece entre sesiones. Es también lo que hace más probable el escenario de `H5`. La limpieza tiene que ser síncrona (ver `.claude/knowledge/nothing-asynchronous-survives-before-quit.md`), y `close()` lo es. |
| `M28` | **Los modales quedan fuera del `ErrorBoundary`.** `App.tsx:117-119`: `ProgramsModal`, `SettingsModal` y `ToastHost` son hermanos del boundary, no hijos. Que `ToastHost` esté afuera es deliberado y está comentado; que los **dos modales** lo estén no: un throw en el render de cualquiera de ellos no tiene red arriba y desmonta la app entera en una ventana en blanco — que es exactamente lo que el boundary existe para evitar. |
| `M29` | **`displays:list` identifica las pantallas por resolución.** `displays.ts:9` arma `label: "1920x1080"`. Dos proyectores o dos monitores del mismo modelo son **indistinguibles en el `Select` de Ajustes → Pantalla**, que es el control con el que el operador elige adónde va la proyección. Electron expone `Display.label` (el nombre real del dispositivo) desde la v22. |
| `M30` | `bible:import` (`handlers/bible.ts:36`) llama `seedBibleFromFile`, que parsea el JSON completo **sincrónicamente en el hilo de main**. Es el mismo patrón que la auditoría transversal identificó como el dominante, pero acá se dispara a pedido del operador, que puede ser a mitad de culto: el hilo que bloquea es el que atiende la ventana de proyección. |
| `M31` | `draftItems()` (`lib/actions/programs.ts:25`) castea a `as never` para deshacerse de `id`/`position`. Es un agujero de tipos en el borde de un canal IPC, en un proyecto que en todo lo demás fuerza exhaustividad por el compilador. Corresponde un `Omit<ProgramItemDTO, "id"|"position">` con un mapeo explícito por `kind`. |

---

## 7. 🔵 Bajos

| # | Hallazgo |
|---|---|
| `L1` | `t()` acepta cualquier `string` (`i18n-provider.tsx:38`): una clave mal escrita no es un error de compilación, **renderiza la clave cruda en pantalla**. `Messages` ya existe; falta derivar un tipo unión de rutas y tiparlo. Medido: **0 claves faltantes hoy** (§8), así que es prevención, no reparación. |
| `L2` | Tres claves i18n se construyen dinámicamente (`settings.transitionDurationOptions.${ms}`, `library.${kind}s` ×2) y por definición escapan a cualquier comprobación. Con `L1` resuelto, conviene convertirlas en `Record`s explícitos. |
| `L3` | `@keyframes toast-exit` (`globals.css:12`) está definido, tiene su variante de `prefers-reduced-motion` y **no lo usa nadie**: los toasts se desmontan sin animación de salida. O se cablea o se borra. |
| `L4` | `HistoryRepo.prune()` usa `NOT IN (SELECT … ORDER BY id DESC LIMIT 5000)`, una subconsulta correlacionada por fila. Está diferido al arranque, así que no molesta; `DELETE … WHERE id <= (SELECT id … LIMIT 1 OFFSET 4999)` es O(1) en comparaciones. |
| `L5` | `itemRefs.current` en `ProgramsModal` (línea 98) nunca se trunca: tras filtrar una lista larga quedan referencias a `<li>` desmontados. Inofensivo (sólo se indexa por `highlightedIndex`), pero retiene nodos. |
| `L6` | `ProgramsModal`: `ArrowUp` desde `highlightedIndex === -1` salta a `0` (`Math.max(i-1, 0)`), asimétrico con `ArrowDown`. Menor, pero es el tipo de detalle que hace que la navegación por teclado se sienta mal. |
| `L7` | La CSP de producción incluye `connect-src … ws://localhost:*` (`index.html:7`, `projection.html:7`), que sólo necesita el HMR de dev. Conviene inyectar la directiva por entorno en vez de embarcar la permisiva. |
| `L8` | `crash.log` (`index.ts:215`) crece sin límite: un fallo repetitivo escribe una línea con stack por ocurrencia, para siempre. Falta rotación o tope. |
| `L9` | `installGlobalErrorHandlers` (`global-error-handlers.ts:15`) muestra `error.message` crudo en un toast — texto técnico, en inglés, con rutas de sistema de archivos, a un operador que usa la app en español. Corresponde un mensaje traducido genérico con el detalle en consola/`crash.log`. |
| `L10` | `removeAsset` (camino no forzado) no llama `cancelDeckJob(id)`; `removeMediaAsset` sólo lo hace en el camino forzado (`media-asset-removal.ts:19`). Borrar un PPT que se está convirtiendo deja el trabajo corriendo hasta el final para un asset que ya no existe. |
| `L11` | `BibleSection.importVersion()` (`bible-section.tsx:12`) no deshabilita el botón mientras importa, no muestra progreso y no reporta éxito ni error. Importar una Biblia son segundos de trabajo sincrónico (`M30`) sin ninguna señal en pantalla. |
| `L12` | `ProjectionSection.changeLogo()` no valida que la imagen elegida sea decodificable. Un PNG corrupto se persiste como `logo.path` y **LOGO queda en negro en el proyector** sin ninguna explicación. |
| `L13` | `settings.transitionDurationOptions.${ms}` (`projection-section.tsx:119`): agregar un valor a `TRANSITION_DURATION_OPTIONS` sin agregar su mensaje rinde silenciosamente el string de la clave en el desplegable. |
| `L14` | `SettingsModal` monta sus tres secciones con ternarios anidados en vez de `TabPanel`/`TabPanels`, que existen en el sistema y preservan scroll y estado. Cambiar de sección desmonta y remonta la sección entera. |
| `L15` | `Select`: `Escape` cierra el menú (`select.tsx:215`) pero no devuelve el foco al disparador, a diferencia de `selectOption` (línea 144), que sí lo hace. |
| `L16` | `Select`: el `<ul role="listbox">` se escribe como hijo JSX del `<button>`. El portal lo saca del DOM antes de que importe, pero leído en el archivo parece contenido interactivo dentro de un botón. Un comentario o mover el portal fuera del `return` del botón lo aclararía. |
| `L17` | `ProgramsModal.handleDrop` no tiene `.catch` sobre `reorderPrograms(...).then(...)`; depende del `unhandledrejection` global. `reorderPrograms` ya devuelve `null` en error, así que sólo un fallo del propio `then` quedaría suelto. |
| `L18` | `Input` envuelve siempre en un `<div className="relative">` aunque no haya `icon`. Un `className` con ancho aplicado al `<input>` no controla el envoltorio, que es lo que ocupa el espacio en un flex. |
| `L19` | `library-sweeper.ts:66`: `setInterval` de 5 min sin `clearInterval`, de por vida. Aceptado por la auditoría transversal como intencional; queda anotado para que la próxima lectura no lo redescubra. |
| `L20` | `reportCrash` registra `uncaughtException` **y deja el proceso vivo**, lo que anula el comportamiento por defecto de Node (abortar). Para esta app probablemente sea la decisión correcta — un culto con la app en estado dudoso es mejor que sin app — pero es una elección con consecuencias (estado potencialmente corrupto) que merece estar escrita al lado del handler. |

---

## 8. ⚪ Informativos, y las mediciones

### 8.1 Cruce de claves i18n — ejecutado

Script en `.scratch/audit/i18n-check.ts` (importa `es.ts`, aplana el diccionario, barre todos los
`t("…")` literales de `src/`):

```
claves definidas:            250
claves literales usadas:     222
FALTANTES (usadas y no definidas):   0   ✅
claves dinámicas (no verificables):  3   → M6 / L2
DEFINIDAS Y NUNCA USADAS:           28   → M6
```

**Cero claves faltantes** es un resultado muy bueno para un diccionario de 250 entradas mantenido a
mano. Lo que sobra es lastre (`M6`), no un defecto visible.

### 8.2 Dependencias — estado medido

| Paquete | Instalado | Última | Salto |
|---|---|---|---|
| **electron** | **36.4.0** | **44.3.0** | **8 líneas mayores — EOL (`C2`)** |
| electron-builder | 25.1.8 | 26.15.3 | 1 mayor |
| electron-vite | 3.1.0 | 5.0.0 | 2 mayores |
| eslint | 9.39.5 | 10.10.0 | 1 mayor |
| typescript | 5.9.3 | 7.0.2 | 2 mayores |
| @vitejs/plugin-react | 4.7.0 | 6.1.1 | 2 mayores |
| eslint-plugin-react-hooks | 5.2.0 | 7.1.1 | 2 mayores |
| lucide-react | 0.511.0 | 1.45.0 | 1.x publicada |
| react / react-dom | 19.2.8 | 19.3.0 | menor |
| @types/node | 22.20.1 | 26.5.1 | 4 mayores |

Ninguna salvo Electron es urgente. La secuencia sensata es **Electron → electron-builder →
electron-vite**, y recién después el resto, con el lockfile ya versionado (`H8`) para que cada paso
sea reversible.

### 8.3 Empaquetado y distribución

| # | Observación |
|---|---|
| `I1` | **Sin firma de código ni notarización.** `package.json` → `build` no tiene `mac.notarize`, ni `afterSign`, ni configuración de certificado para `win`. Un `.dmg` sin firmar lo bloquea Gatekeeper; un `.exe` NSIS sin firmar dispara SmartScreen. Para una app que instalan voluntarios en la PC de la cabina, es fricción real en el único momento en que nadie la puede acompañar. |
| `I2` | **Sin auto-update.** No hay `electron-updater` ni bloque `publish`. Cada corrección de esta lista requiere que alguien lleve un instalador a la máquina. Cuando `C2` se resuelva, esto es lo que decide si el próximo Electron llega o no. |
| `I3` | **Sin pruebas automatizadas ni CI.** `db:smoke` y `slides:smoke` son scripts de humo, valiosos pero manuales. No hay runner de tests (Vitest encajaría sin fricción con el stack de Vite ya montado) ni workflow que corra `typecheck && lint && db:smoke` en cada push. `CLAUDE.md` lo reconoce; queda anotado con la recomendación concreta. |
| `I4` | Sin `build.sourcemap` en producción: un stack de `crash.log` de una máquina empaquetada apunta a código minificado. |

### 8.4 Lo que está bien y conviene no tocar

Vale decirlo, porque la lista de arriba es larga y no es representativa del promedio:

- **La disciplina de tokens semánticos es real.** `grep` de `#hex` y de `bg-[...]` sobre
  `components/pages/**` da **cero**. La regla no negociable de `CLAUDE.md` se cumple; el problema de
  `H7` no es indisciplina, son los valores de los tokens.
- **`trusted-senders.ts`** es exactamente la pieza correcta junto a un puente de preload genérico, y
  su comentario documenta con precisión qué cubre y qué no.
- **`registerHandlers<Handlers>`** convierte un canal faltante en error de compilación. Es la mejor
  decisión estructural del proyecto.
- **La CSP está puesta en las tres ventanas**, y la de `rasterizer.html` (`default-src 'none'`) es
  ejemplar: la ventana con menos superficie es la que menos permisos tiene.
- **`selectOutputMemo`** resuelve por comparación de entradas lo que antes se resolvía serializando
  la salida 4 veces por segundo. Es el patrón correcto y está bien explicado.
- **`Monitor` + `OutputView` compartidos entre proyector y monitores** es lo que hace estructuralmente
  imposible que un monitor mienta. No aflojarlo.
- **`live-intent.ts`**, **`deck.store`'s `generation`** y **`library.store`'s `requestSeq`** son tres
  instancias del mismo patrón (contador de generación contra resultados tardíos) aplicado en los
  tres lugares donde hacía falta. Consistente y correcto.
- **`thumb-tile.geometry.ts`**: números impuestos por el CSS, no estimados de él, con el porqué
  escrito. Es el estándar al que debería aspirar el resto.
- **`freezeLivePositions`** cubre los tres caminos que destruyen la ventana de proyección, no dos.

---

## 9. Verificación

### 9.1 Automática — ejecutada en este árbol

```
npm run typecheck   ✅  (node + web)
npm run lint        ✅  0 errores, 5 warnings preexistentes de react-refresh
git ls-files package-lock.json   → vacío (confirma H8)
node -p electron/package.json .version → 36.4.0 (confirma C2)
.scratch/audit/i18n-check.ts    ✅  0 claves faltantes, 28 sobrantes
cálculo de contraste WCAG        ✅  tabla de H7
```

### 9.2 Manual — **pendiente**, en orden de prioridad

Ninguna de estas se ejecutó: esta auditoría es estática por definición (§2 del README de
`auditorias/`). Son la checklist que le corresponde.

1. **`C1`** — arrastrar un `.mp4` desde Finder y soltarlo **sobre la `TopBar`** (fuera de toda zona
   de drop). Confirmar si la ventana navega al archivo. Repetir sobre la columna de monitores y
   sobre el hueco entre paneles. *Es la prueba que decide si `C1` es bloqueante o alto.*
2. **`H2`** — con un orden de culto sin guardar, apretar ⌘R. Confirmar que se pierde. Repetir con ⌘W.
3. **`H3`** — abrir un programa A, abrir el modal, hacer **un clic** (no doble) sobre el programa B,
   cerrar el modal. Consultar `projection_history` tras proyectar algo: confirmar que el `programId`
   es el de B. Confirmar además que `lastOpenedAt` de B se movió.
4. **`H4`** — seleccionar un recurso no usado por ningún programa y apretar `Supr`. Confirmar que
   desaparece sin preguntar.
5. **`M24`** — empezar a arrastrar el scrubber y forzar un `pointercancel` (cambiar de app con el
   botón apretado, o un gesto de tres dedos). Confirmar si la barra queda siguiendo el cursor.
6. **`M12`** — enfocar el scrubber con Tab durante un deck en vivo y apretar `→`. Confirmar que
   avanza la diapositiva **y** busca 5 s.
7. **`H1`** — abrir Ajustes y tabular hasta salir del diálogo. Confirmar que el foco llega a la
   `TopBar` de atrás.
8. **`M25`** — con el proyector abierto y nada en vivo, confirmar que el escenario muestra el logo
   mientras la insignia dice "Sin señal".
9. **`H5`** — matar el proceso con la app escribiendo, verificar que queda un `-wal` no vacío,
   forzar una migración pendiente y comparar el respaldo contra la base.
10. **`M29`** — con dos pantallas del mismo modelo, confirmar que el `Select` de Ajustes muestra dos
    opciones idénticas.

### 9.3 Lo que esta auditoría no pudo cubrir

- **Todo lo que necesita una segunda pantalla física** — misma limitación que el informe de la
  feature #5.
- **Windows y Linux.** El informe asume macOS. `C1` y `H2` dependen del menú por defecto de
  Electron, que difiere por plataforma (en Windows no hay menú de aplicación salvo que se cree uno,
  así que ⌘R/Ctrl+R puede o no estar ligado). `M29` depende de cómo cada SO nombra sus displays.
- **El comportamiento real bajo carga de las grillas no virtualizadas** (`M9`, `M10`): el análisis
  es por conteo de nodos, no por medición de frames.
- **Los tiempos de `M7`/`M8`**: son N+1 por lectura del código, no perfilados.

---

## 10. Prioridad sugerida

**Tanda 1 — antes del próximo culto (horas).** Todo barato, todo verificable, nada estructural.

1. `C1` — los tres `preventDefault` + los dos guards de navegación en main.
2. `H8` — versionar el lockfile.
3. `H4` — confirmación (o toast de deshacer) en el borrado de recursos.
4. `M24` — `onPointerCancel` en el scrubber.
5. `M12` — `role="slider"` en la lista de lo que consume flechas.
6. `H7` (la mitad barata) — `text-foreground` en las cinco variantes de `Badge`: de ~2,3 a ~13.

**Tanda 2 — la semana siguiente (días).**

7. `H3` — separar `programs:peek` de `programs:load`.
8. `H2` — `beforeunload` + menú propio (que cierra además el ⌘W de la feature #5).
9. `H5` — `sqlite.backup()`/`VACUUM INTO` + `integrity_check`, y `M27` en el mismo commit.
10. `H6` — validación por clave en `settings:set`.
11. `H7` (la otra mitad) — rampa "on-dark" para `danger`/`primary`/`subtle`.
12. `H1` — `<dialog>` nativo, o trap de foco.

**Tanda 3 — fuera de temporada (semanas).**

13. `C2` — Electron 36 → línea soportada, con `electron-builder` y `electron-vite` detrás.
14. `H9` — `recommendedTypeChecked` + `jsx-a11y`, escalonado.
15. `M9`/`M10` — virtualizar las dos grillas de contenido.
16. `M7`/`M8` — el N+1 de `ProgramsRepo`.
17. `I3` — Vitest + un workflow de CI con la barra mínima.

**Decisiones de producto, no de ingeniería** (necesitan que el usuario elija, no que alguien
corrija): `M1` (dónde va el botón de relocalizar), `M2` (dónde vive el control de volumen —
¿por pista, global, en Ajustes?), `M3` (¿se quieren ítems de texto, o se borra el tipo?), `M5`
(qué exponer de la caché en Ajustes), `I1`/`I2` (firma y auto-update: cuestan dinero y cuentas).

---

## 11. Fuentes consultadas

- [Electron — Security, Native Capabilities, and Your Responsibility](https://docs.w3cub.com/electron/tutorial/security) · [Opening windows from the renderer (`setWindowOpenHandler`)](https://www.electronjs.org/docs/latest/api/window-open) · [`webContents` (`will-navigate`)](https://www.electronjs.org/docs/latest/api/web-contents) · [Native File Drag & Drop](https://www.electronjs.org/docs/latest/tutorial/native-file-drag-drop) · [electron/electron#908 — "Can't prevent dropped file from opening in Window"](https://github.com/electron/electron/issues/908) · [Quasar — Electron Security Concerns](https://quasar.dev/quasar-cli-vite/developing-electron-apps/electron-security-concerns/) — `C1`, `H2`
- [Electron Releases — Schedule](https://releases.electronjs.org/schedule) · [Electron Timelines](https://www.electronjs.org/docs/latest/tutorial/electron-timelines) · [endoflife.date — Electron](https://endoflife.date/electron) — `C2`
- [SQLite User Forum — Hot backup of a WAL-mode database by copying](https://sqlite.org/forum/forumpost/2ea989bbe9) · [SQLite User Forum — Safe copy of a SQLite database](https://sqlite.org/forum/info/3606234416ea233cb095e0f9a5b3161ac2139ddbabe1edbf1798be75d147675e) · [How to Back Up a WAL-Mode SQLite Database Without Losing Data](https://oneuptime.com/blog/post/2026-09-08-back-up-wal-mode-sqlite-safely/view) — `H5`
- [The Modern Modal in 2026: Using the HTML `<dialog>` Element Without Accessibility Traps](https://www.dfm2html.com/tutorials/the-modern-modal-in-2026-using-the-html-dialog-element/) · [Accessible Dialog & Modal Guide (WAI-ARIA + `<dialog>`)](https://accessibility.build/guides/accessible-dialog) · [There is No Need to Trap Focus on a Dialog Element](https://news.lavx.hu/article/there-is-no-need-to-trap-focus-on-a-dialog-element) — `H1`, `M15`
- [Dark Mode Contrast: The Complete Guide to WCAG-Compliant Dark UI (2026)](https://www.colorcontrast.org/blog/dark-mode-contrast-accessibility-guide/) · [Primer — Color considerations](https://primer.style/accessibility/design-guidance/color-considerations/) · [Offering a Dark Mode Doesn't Satisfy WCAG Color Contrast Requirements](https://www.boia.org/blog/offering-a-dark-mode-doesnt-satisfy-wcag-color-contrast-requirements) — `H7`
- [typescript-eslint — `no-floating-promises`](https://typescript-eslint.io/rules/no-floating-promises/) · [`no-misused-promises`](https://typescript-eslint.io/rules/no-misused-promises/) · [Rules overview](https://typescript-eslint.io/rules/) — `H9`
