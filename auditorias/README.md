# Auditorías — WorshipApp

Índice de las auditorías del proyecto. Cada una queda como un **reporte inmutable y fechado** en
`reports/`: se lee como una foto del sistema en ese momento, no se reescribe después. Lo que se
arregla a partir de ella se anota en el propio reporte, en su sección de estado.

Hay dos formas de producir una:

| | Auditoría de feature | Auditoría transversal |
|---|---|---|
| Cómo se corre | el skill `/audit-page <feature>` | a pedido, leyendo el área entera |
| Alcance | una feature de punta a punta: contrato IPC → handlers de main → renderer/Zustand → design system | un eje que cruza todas las features (memoria, performance, ciclo de vida, seguridad) |
| Archivo | `reports/<feature>.md` | `reports/<fecha>-<tema>.md` |

Ninguna de las dos levanta la app **para producir el diagnóstico**: son análisis estático más una
checklist de verificación manual. Esa checklist sí se ejecuta después, manejando la app por CDP, y
el reporte dice explícitamente qué se verificó, con qué números y qué quedó sin poder verificarse.

## Leyenda de estado

| Símbolo | Significado |
|---|---|
| ⬜ | Sin auditar |
| 🔵 | En progreso |
| 🟡 | Hallazgos abiertos |
| 🟢 | Limpia |

## Auditorías transversales

| Fecha | Tema | Estado | Hallazgos | Informe |
|---|---|---|---|---|
| 2026-09-11 | Cadena de procesamiento de media de punta a punta (import → conversión → caché → serving → proyección), los dos paneles de la primera columna y el sistema que los sostiene | 🟡 | 3 críticos + 18 altos + 52 de las 54 filas del catálogo **arregladas** · **ningún defecto abierto**: quedan `M23` (solo Linux, no verificable acá) y `M42` (necesita decisión de UI) · quinta sesión (2026-09-13): 11 de los 13 de rendimiento cerrados, y **el pase automático perdido** — no era de los archivos ni de nuestro parser sino del exportador a `.pptx` de LibreOffice, **222 de 1226 decks del himnario**, arreglado leyendo los tiempos del binario de origen + backfill de 122 decks en 42 ms sin reconvertir | [`2026-09-11-cadena-de-media.md`](reports/2026-09-11-cadena-de-media.md) · [handoff](reports/2026-09-11-cadena-de-media-HANDOFF.md) |
| 2026-09-13 | **Todo lo que las auditorías anteriores no cubrieron**: las features 7, 8 y 9, más el design system completo, accesibilidad, i18n, hardening de Electron, build y dependencias, la capa de datos que faltaba y un barrido de código muerto | 🟡 | **76 hallazgos, 25 cerrados** — **Tanda 5 (§1.septies, 2026-09-14): todo el bloque de rendimiento abierto** (`M9`, `M10`, `M26`, `M7`, `M8`) más el callejón sin salida de teclado (`M13`); `M11` se midió y **se descartó** porque ya no describe el código de hoy. Medido contra la app real: el Salmo 119 pasó de 352 tiles montados a **40**, un deck de 22 diapositivas monta 14, y un programa que perdía **7 de 9** nombres al desalojarse la caché ahora no pierde ninguno. Las grillas además **siguen solas** a lo que marcan. De paso salió un defecto que ninguna auditoría tenía: un salto de teclado que cruza la ventana montada dejaba el foco en `<body>`. Antes: **17 cerrados** — Tanda 1 (§1.bis), Tanda 2 (§1.quater), Tanda 3 (§1.quinquies: `M1` `M2`) y **Tanda 4 (§1.sexies, 2026-09-14): el bloqueante `C2` cerrado — Electron 36.4.0 → 44.3.0, `electron-builder` 25→26, `electron-vite` 3→5, Vite 6→7, sin una sola línea de código de la app; queda `H9` y las dos de rendimiento**. **Ya no hay ningún bloqueante abierto.** Diagnóstico original: **76 hallazgos, 6 cerrados** (Tanda 1: `C1`, `H4`, `H7`-mitad, `H8`, `M12`, `M24` — ver §1.bis del informe) — 🔴 2 + 🟠 9 + 🟡 31 + 🔵 20 + ⚪ 14. Los dos bloqueantes: **soltar un archivo fuera de una zona de drop navega la ventana de control fuera de la app**, y **Electron 36 está EOL** (instalado 36.4.0, línea soportada 44.x). Tres mediciones: el contraste del tema oscuro falla WCAG en casi todo el color (los 5 badges entre **2,18 y 3,19:1**, y el aviso de error a **2,35:1**), **0 claves i18n faltantes** de 250 y 28 sobrantes, y **tres features cableadas de punta a punta sin ningún punto de entrada en la UI** (`library:relocate`, el control de volumen y los ítems de texto). Dos bugs de campo posteriores quedaron **fuera** de este informe y viven en el suyo — ver §1.ter | [`2026-09-13-transversal-general.md`](reports/2026-09-13-transversal-general.md) · [handoff](reports/2026-09-14-tanda-2-HANDOFF.md) |

Cuando una auditoría deja trabajo aplicado o pendiente, lleva un **handoff** al lado del informe:
el informe es el diagnóstico (inmutable), el handoff es el runbook — en qué estado quedó el repo,
cómo verificarlo y qué sigue.

## Bugs de campo

Defectos que **no** salieron de una auditoría sino de usar la app. Llevan su propio informe fechado
en `reports/` porque no pertenecen a la foto estática de ninguna: se diagnostican **levantando la
app**, y se numeran `F<n>` para que nunca choquen con los ids de una auditoría.

| Fecha | Qué se reportó | Estado | Hallazgos | Informe |
|---|---|---|---|---|
| 2026-09-13 | Dos síntomas vistos usando la app después de la Tanda 1 de la transversal general | 🟢 | **los 2 cerrados el 2026-09-14** (§8 del informe). `F1`: el toast se empuja desde `removeAsset`, así que corre una vez por gesto por construcción — y `RemoveAssetConfirm`, que también estaba montado una vez por pestaña, pasó a `App`; medido, 5 paneles → 1 toast y 1 diálogo. `F2`: se implementó la opción (b), la disolvencia real — el último frame del video saliente se congela en un `<canvas>` desde la limpieza de un `useLayoutEffect` (el único punto donde el elemento todavía tiene píxeles) y la capa saliente lo funde; medido 1,000→0,009 contra 0,000→0,991 en paralelo, 300 ms, sin negro y sin salto. De paso cierra la "limitación conocida" de video→imagen. Diagnóstico original: **2 abiertos, los dos 🟠**. `F1`: quitar un recurso de "Usados recientemente" muestra el mismo toast **una vez por pestaña de recursos visitada** — medido, 5 paneles → 4 toasts, 2 paneles → 1; es una regresión del arreglo `M43` (las pestañas ya no se desmontan) sobre un flag global de un solo uso consumido en un efecto por instancia, y de paso **vacía la pila de toasts**, que tiene tope 4. `F2`: **video → video no hace la disolvencia**, siempre pasa por negro — el único `<video>` montado es el entrante y `videoRole` le da el papel de saliente, así que reproduce el fade-out (medido: opacidad 1,000 → 0,024 en 267 ms, y salto a 1,000 a los 330 ms). Las otras tres combinaciones se midieron y están bien | [`2026-09-13-bugs-de-campo.md`](reports/2026-09-13-bugs-de-campo.md) |

## Auditorías por feature

| # | Feature | Archivos principales | Estado | Hallazgos | Última auditoría | Informe |
|---|---|---|---|---|---|---|
| 1 | Programa (schedule) | `pages/schedule/`, `stores/program.store.ts`, `ipc/handlers/programs.ts` | 🟡 | cubierto en parte por la transversal — **todo arreglado** (B1, B2, M24, M26, M47, L1–L3); falta verificarlo en la app | 2026-09-13 | — |
| 2 | Biblioteca de medios | `pages/resources/`, `stores/library.store.ts`, `services/library-import.ts` | 🟡 | cubierto en parte por la transversal (B3, B6, B7, M13, M29–M31, M38, M39, M43, L4–L6 y **`N3`** arreglados); de la transversal general, **`H4` arreglado** — borrar un recurso ahora es diferido y deshacible por toast; queda `M42` abierto — paginar `library:list`, que es una feature con decisión de UI, no un ajuste de rendimiento. **`F1` cerrado (2026-09-14)**: el toast se empuja desde la acción y el diálogo de confirmación se monta una sola vez en `App` | 2026-09-13 | [`2026-09-13-bugs-de-campo.md`](reports/2026-09-13-bugs-de-campo.md) |
| 3 | Biblia | `pages/resources/bible-browser.tsx`, `db/repositories/bible.repo.ts` | 🟡 | cubierto en parte por la transversal — **todo arreglado** (C3, B6, M26, M45); falta verificarlo en la app | 2026-09-13 | — |
| 4 | Presentaciones (LibreOffice) | `slides/`, `stores/deck.store.ts` | 🟢 | cubierto en parte por la transversal — **todo arreglado** (C1, A1–A5, M1–M12, M18, M20–M22, M44). Quinta sesión: el auto-avance que el round-trip a `.pptx` perdía en 222 de 1226 decks del himnario, ahora leído del binario de origen (§11 del informe) | 2026-09-13 | — |
| 5 | Negro / Logo / En vivo | `lib/actions/playback.ts`, `lib/actions/live-intent.ts`, `lib/actions/live-positions.ts`, `stores/projection.store.ts`, `stores/display.store.ts`, `lib/hooks/use-global-shortcuts.ts`, `main/services/projection-state.ts` | 🟢 | **todo arreglado** — 🔴 1 + 🟠 3 en la primera pasada; 🟡 `M1` + 🔵 `L1` + el ⚪ de LIMPIAR (decisión deliberada: se queda en Ajustes) en la segunda, más el aviso de proyector caído que `C1` no llevaba. `M1` escondía algo peor que audio reiniciado: un deck con banda sonora **volvía a la diapositiva 1** al reabrir. **Checklist manual corrido por CDP contra la app real** (6 de 8 casos ✅); los 2 restantes necesitan una segunda pantalla o una lista de pantallas vacía | 2026-09-13 | [`AUDIT-black-logo-2026-09-13.md`](reports/AUDIT-black-logo-2026-09-13.md) |
| 6 | Proyección | `windows/projection-window.ts`, `projection/`, `components/shared/output-view.tsx` | 🟡 | cubierto en parte por la transversal — **todo arreglado** (C2, M25, M27, M28, M34, M40, M41, N1); falta verificarlo en la app. **`F2` cerrado (2026-09-14)**: disolvencia real con el último frame del video saliente congelado en la capa saliente; también arregla video→imagen, que era una limitación documentada | 2026-09-13 | [`2026-09-13-bugs-de-campo.md`](reports/2026-09-13-bugs-de-campo.md) |
| 7 | Monitores (columna 3) | `pages/monitors/` (7 archivos, 590 líneas) | 🟡 | **auditada** por la transversal general — `M12` (flechas del scrubber colisionando con el avance de diapositiva en vivo) y `M24` (el scrubber pegado al cursor tras un `pointercancel`) **arreglados**; `M9`/`M10` **cerrados en la Tanda 5**: la grilla en vivo está virtualizada y **sigue al proyector** (auto-avance incluido), medido en 40 tiles montados donde había 352. Abierto: `M25` (la insignia dice "Sin señal" mientras el proyector muestra el LOGO) | 2026-09-13 | [`2026-09-13-transversal-general.md`](reports/2026-09-13-transversal-general.md) |
| 8 | Diapositivas (columna 2) | `pages/slides/` (3 archivos, 404 líneas) | 🟢 | **auditada** por la transversal general — **todo cerrado**: `M1` en la Tanda 3 (el botón Relocalizar… en el panel de archivo faltante) y `M10`/`M13` en la Tanda 5 (la grilla virtualizada, que sigue al cursor de preview y trae flechas, `Home`/`End` y roving tabindex). Falta la verificación manual de `M1` en la app | 2026-09-13 | [`2026-09-13-transversal-general.md`](reports/2026-09-13-transversal-general.md) |
| 9 | Programas y Ajustes (modales) | `pages/programs/`, `pages/settings/` (8 archivos) | 🟡 | **auditada** por la transversal general — **`H1`, `H3`, `H6` y `M22` cerrados en la Tanda 2 (2026-09-14)**: trap de foco + `inert` + `aria-modal`/`aria-labelledby` sobre el portal existente, canal `programs:peek` de solo lectura, validadores por clave en `settings:set`, y el tono de advertencia con su propio token. Abiertos: `M2`/`M5` (sin control de volumen ni de la caché), `M20`/`M21` (textarea a mano, sin escala de z-index) | 2026-09-14 | [`2026-09-13-transversal-general.md`](reports/2026-09-13-transversal-general.md) |

_Última actualización del índice: 2026-09-14 (decimotercera sesión — **Tanda 5: el bloque de
rendimiento entero**. Las cuatro grillas de contenido pasaron a `VirtualGrid` con su geometría
compartida en `components/ui/slide-grid.geometry.ts`, y con seguimiento automático de lo que está
en el aire y del cursor de preview; contador de referencias en la caché de `useMediaAsset`, que era
un defecto vivo con 1498 assets; el N+1 de `ProgramsRepo` en una consulta y el reorder en una
sentencia con `json_each`. `M11` se descartó con medición en vez de implementarse. Verificado por
CDP contra la biblioteca real del usuario, y `db:smoke` ganó dos aserciones sobre `itemCount`).
Anterior: 2026-09-14 (duodécima sesión — **Tanda 4: el bloqueante `C2`**.
Electron 36.4.0 → 44.3.0 (Chromium 152) con `electron-builder` 26, `electron-vite` 5 y Vite 7, sin
tocar código de la app: de las ocho versiones de rupturas, este proyecto no usaba nada de lo que se
rompió. Lo que sí rompió fue el `postinstall` — desde la v42 el paquete `electron` no baja su
binario, y solo `npm run dev` se entera. Revalidado contra la app real en dev y empaquetada: sandbox
del preload, `webUtils`, prebuilds N-API, las dos ventanas, `worship://` con `Range` (seek pedido a
38,43 s → aterrizó en 38,43 s), FTS5 y el pipeline de LibreOffice. El instalador de Windows queda
sin poder generarse acá por falta de Rosetta — pre-existente, y `win-unpacked/` sí sale completo).
Anterior: 2026-09-14 (décima sesión — **Tanda 2 de la transversal general y
los dos bugs de campo**: trap de foco e `inert` en los modales, el orden de culto sin guardar
espejado a SQLite con menú propio y guard de cierre, `programs:peek`, respaldo previo a migración
con `VACUUM INTO`+`integrity_check` y cierre de la base al salir, validación por clave de
`settings:set`, la rampa `-ink` que saca el texto de color del tema oscuro de 2,3 a 5–6, el toast de
borrado que se empujaba una vez por pestaña, y la disolvencia video→video con el último frame
congelado. Verificado contra la app real por CDP y AppleScript; `db:smoke` pasó de 15 a 18 casos).
Anterior: 2026-09-13 (novena sesión — Tanda 1 de la transversal general aplicada: los tres guards de navegación y de drop que cerraban el bloqueante `C1`, borrado de recursos diferido y deshacible, contraste de los badges, lockfile versionado, y las dos correcciones del scrubber. Después, dos bugs reportados por el operador usando la app — `F1` y `F2` — reproducidos y medidos por CDP contra la instancia real, en su propio informe de bugs de campo)._
