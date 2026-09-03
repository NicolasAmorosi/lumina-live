# 07 — Roadmap y deuda conocida

## Estado de esta migración

Se completó: andamiaje `electron-vite` + TS estricto, el design system (`components/ui`+
`shared`), la capa de datos completa (SQLite + Drizzle + FTS5, con smoke test verificado), el
contrato IPC tipado end-to-end, el protocolo `worship://`, PowerPoint con escapado seguro, la
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
- **Atajos de teclado**: ni siquiera el Delete/Backspace de la legacy está bindeado todavía.
  Agregar además flechas para avanzar slide/versículo (mejora, no paridad) queda pendiente.
- **Barra de progreso de video sincronizada con la proyección real**: hoy el control abre el
  `<video>` en la ventana de proyección pero no escucha su progreso. El diseño ya contempla un
  evento `video-status` (proyección → main → control) en `shared/ipc/contract.ts` — falta
  implementar el emisor en `ProjectionApp.tsx` y el listener en `PreviewPanel`.
- **UI de favoritos e historial bíblico**: las tablas `bible_favorites` y `projection_history` y
  sus repos existen y funcionan (`HistoryRepo.record()` ya se llama en cada
  `projection:show`), pero no hay pantalla que los liste todavía.
- **`ppt_slide_cache` (tabla)**: el cache de slides exportados de v1 vive en memoria
  (`main/ipc/handlers/ppt.ts`) y se pierde al reiniciar la app. La tabla está en el esquema para
  cuando se quiera un cache persistente entre sesiones.
- **Ajustes de proyección configurables** (tamaño de fuente, alineación) para biblia/texto: hoy
  siguen hardcodeados en `vw` dentro de `ProjectionApp.tsx`, igual que la legacy.
- **Pantalla de Configuración**: el toggle de tema vive en el header; falta una página dedicada
  para volumen de media, idioma (cuando haya más de un diccionario) y demás `settings`.

## Validación pendiente — requiere Windows

Nadie validó en Windows real: abrir/cerrar un `.pptx`, avanzar/retroceder slides, exportar
miniaturas, el audio `.mp3` hermano, y la danza del overlay NEGRO/LOGO sobre un slideshow activo.
La lógica es funcionalmente idéntica a la legacy salvo el transporte (`-EncodedCommand` en vez de
interpolación de strings) — pero **hasta que se valide en Windows, no se borra `legacy/`**.

## Objetivo: multiplataforma para PowerPoint

Sin cambios respecto al diagnóstico legacy: seguir siendo Windows-only por el COM real. Caminos a
evaluar cuando se aborde esto — LibreOffice headless (`soffice --headless --convert-to png`) o
requerir que el usuario pre-convierta a video/imágenes.

## Objetivo: más idiomas

La infraestructura de i18n (`lib/i18n/`) ya soporta agregar diccionarios — hoy solo existe
`es`. Sumar `it`/`en` es agregar un archivo en `lib/i18n/messages/` y una entrada en
`dictionaries` (`i18n-provider.tsx`), sin tocar componentes.
