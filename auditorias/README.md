# Auditorías — WorshipApp

Índice de auditorías de features producidas por el skill `/audit-page`. Cada auditoría cubre una
feature end-to-end (`main.js` → `preload.js` → `app.js` → HTML/CSS) y queda registrada como un
reporte inmutable en `reports/`.

## Cómo se corre una auditoría

```
/audit-page playlist
/audit-page bible
/audit-page ppt
```

No requiere levantar nada — es análisis estático de los 5 archivos fuente más una checklist de
verificación manual (no hay Playwright/browser automation para Electron acá). Si el reporte
incluye verificación manual, va marcado explícitamente; si no se ejecutó, el reporte dice por qué.

## Leyenda de estado

| Símbolo | Significado |
|---|---|
| ⬜ | Sin auditar |
| 🔵 | En progreso |
| 🟡 | Hallazgos abiertos |
| 🟢 | Limpia |

## Estado por feature

| # | Feature | Archivos principales | Estado | Hallazgos | Última auditoría | Informe |
|---|---|---|---|---|---|---|
| 1 | Playlist | `app.js` (playlist), `main.js` (files/display) | ⬜ | — | — | — |
| 2 | Biblioteca de medios | `app.js` (library), `main.js` (media-library) | ⬜ | — | — | — |
| 3 | Biblia | `app.js` (bible), `main.js` (bible), `data/bible/` | ⬜ | — | — | — |
| 4 | PowerPoint | `main.js` (ppt-*), `app.js` (ppt) | ⬜ | — | — | — |
| 5 | Negro / Logo / En vivo | `app.js` (toggle*, restorePrevious) | ⬜ | — | — | — |
| 6 | Display / proyección | `main.js` (display), `presentation.html` | ⬜ | — | — | — |

_Última actualización del índice: 2026-09-02 (0 de 6 auditadas — índice creado junto con la base
de conocimiento del proyecto)._
