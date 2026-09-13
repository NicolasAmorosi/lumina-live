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

Cuando una auditoría deja trabajo aplicado o pendiente, lleva un **handoff** al lado del informe:
el informe es el diagnóstico (inmutable), el handoff es el runbook — en qué estado quedó el repo,
cómo verificarlo y qué sigue.

## Auditorías por feature

| # | Feature | Archivos principales | Estado | Hallazgos | Última auditoría | Informe |
|---|---|---|---|---|---|---|
| 1 | Programa (schedule) | `pages/schedule/`, `stores/program.store.ts`, `ipc/handlers/programs.ts` | 🟡 | cubierto en parte por la transversal — **todo arreglado** (B1, B2, M24, M26, M47, L1–L3); falta verificarlo en la app | 2026-09-13 | — |
| 2 | Biblioteca de medios | `pages/resources/`, `stores/library.store.ts`, `services/library-import.ts` | 🟡 | cubierto en parte por la transversal (B3, B6, B7, M13, M29–M31, M38, M39, M43, L4–L6 y **`N3`** arreglados); queda `M42` abierto — paginar `library:list`, que es una feature con decisión de UI, no un ajuste de rendimiento | 2026-09-13 | — |
| 3 | Biblia | `pages/resources/bible-browser.tsx`, `db/repositories/bible.repo.ts` | 🟡 | cubierto en parte por la transversal — **todo arreglado** (C3, B6, M26, M45); falta verificarlo en la app | 2026-09-13 | — |
| 4 | Presentaciones (LibreOffice) | `slides/`, `stores/deck.store.ts` | 🟢 | cubierto en parte por la transversal — **todo arreglado** (C1, A1–A5, M1–M12, M18, M20–M22, M44). Quinta sesión: el auto-avance que el round-trip a `.pptx` perdía en 222 de 1226 decks del himnario, ahora leído del binario de origen (§11 del informe) | 2026-09-13 | — |
| 5 | Negro / Logo / En vivo | `lib/actions/playback.ts`, `lib/actions/live-intent.ts`, `stores/projection.store.ts`, `stores/display.store.ts`, `lib/hooks/use-global-shortcuts.ts`, `main/services/projection-state.ts` | 🟡 | 🔴 1 + 🟠 3 **arreglados** (el control nunca se enteraba de que el proyector se cerró; `B`/`L` muertos tras clic en cualquier botón; cambiar de pantalla no movía nada; dos escrituras al proyector fuera del guard de intención) · quedan 🟡 1 + 🔵 1 + ⚪ 2 catalogados · **el checklist manual necesita una segunda pantalla** | 2026-09-13 | [`AUDIT-black-logo-2026-09-13.md`](reports/AUDIT-black-logo-2026-09-13.md) |
| 6 | Proyección | `windows/projection-window.ts`, `projection/`, `components/shared/output-view.tsx` | 🟡 | cubierto en parte por la transversal — **todo arreglado** (C2, M25, M27, M28, M34, M40, M41, N1); falta verificarlo en la app | 2026-09-13 | — |
| 7 | Monitores (columna 3) | `pages/monitors/` (7 archivos, 590 líneas) | ⬜ | — la transversal no nombra ninguno de estos archivos | — | — |
| 8 | Diapositivas (columna 2) | `pages/slides/` (3 archivos, 404 líneas) | ⬜ | — sin cubrir | — | — |
| 9 | Programas y Ajustes (modales) | `pages/programs/`, `pages/settings/` (8 archivos) | ⬜ | — sin cubrir | — | — |

_Última actualización del índice: 2026-09-13 (sexta sesión — auditoría de la feature #5 y las filas 7–9, que la auditoría de cobertura encontró sin cubrir)._
