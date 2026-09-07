# 07 — Roadmap y deuda conocida

## Estado de esta migración

Se completó: andamiaje `electron-vite` + TS estricto, el design system (`components/ui`+
`shared`), la capa de datos completa (SQLite + Drizzle + FTS5, con smoke test verificado), el
contrato IPC tipado end-to-end, el protocolo `worship://`, el pipeline de diapositivas con
LibreOffice headless (multiplataforma, ver `03-slides-libreoffice.md`), la
ventana de proyección declarativa, y una UI de control funcional para las 6 áreas de
`auditorias/README.md` (playlist, biblioteca, biblia, PPT, negro/logo, display) más el módulo
nuevo de servicios guardados.

**No se implementó** (fuera de alcance explícito de esta tarea, acordado con el usuario):
canciones/letras con secciones proyectables.

## Deuda dejada conscientemente para una siguiente sesión

- **Drag & drop real de archivos del SO** al playlist/biblioteca: la legacy lo tenía
  (`setupDragDrop`, `app.js:116`); esta migración prioritizó la persistencia y el contrato tipado
  y dejó el alta de archivos solo vía el diálogo (`files:pick`). El drag interno
  playlist↔biblioteca (`draggable` en las filas) está scaffoldeado pero sin `onDrop` implementado.

- **Barra de progreso de video**: el transporte ya existe (`MediaStatus` + `media-status` se
  emiten desde `ProjectionApp` para `<video>` y `<audio>`, y `components/ui/progress-bar.tsx` es
  determinada) — falta solo conectarlo en la vista previa de un video, como ya está hecho para el
  tiempo hasta la próxima diapositiva de un deck.
- **UI de favoritos e historial bíblico**: las tablas `bible_favorites` y `projection_history` y
  sus repos existen y funcionan (`HistoryRepo.record()` ya se llama en cada
  `projection:show`), pero no hay pantalla que los liste todavía.
- **Video embebido dentro de una diapositiva**: se detecta y se loguea al convertir, pero no se
  extrae ni se reproduce (fuera de alcance acordado). El audio embebido sí funciona.
- **Ajustes de proyección configurables** (tamaño de fuente, alineación) para biblia/texto: hoy
  siguen hardcodeados en `vw` dentro de `ProjectionApp.tsx`, igual que la legacy.
- **Pantalla de Configuración**: el toggle de tema vive en el header; falta una página dedicada
  para volumen de media, idioma (cuando haya más de un diccionario) y demás `settings`.

## Multiplataforma — resuelto

Ya no hay nada Windows-only. El COM/PowerShell se eliminó por completo y las presentaciones se
convierten con LibreOffice headless, que corre igual en macOS, Windows y Linux. LibreOffice **no
se empaqueta**: la app lo detecta en el sistema (con override manual en `slides.sofficePath`) y,
si falta, la UI explica cómo instalarlo.

Verificado en macOS contra decks reales de iglesia, incluyendo un `.ppt` binario de 52
diapositivas y un fixture con auto-avance + audio embebido. `legacy/` ya **no** está bloqueado por
una validación en Windows.

## Objetivo: más idiomas

La infraestructura de i18n (`lib/i18n/`) ya soporta agregar diccionarios — hoy solo existe
`es`. Sumar `it`/`en` es agregar un archivo en `lib/i18n/messages/` y una entrada en
`dictionaries` (`i18n-provider.tsx`), sin tocar componentes.
