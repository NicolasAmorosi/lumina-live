# 06 — UI y sistema de diseño

## Origen: calcado de `libretto-villaaurora`

La arquitectura de `src/renderer/src/components/` (no la paleta) es una copia deliberada de
`libretto-villaaurora/apps/web/src/components`: `ui/` (primitivas), `shared/` (composiciones
cross-feature), `pages/` (una carpeta por feature). Ver la sección "Reutilización de componentes"
en `CLAUDE.md` — es la regla que no se negocia en este repo.

Piezas copiadas casi literalmente porque resuelven un problema no obvio:

- `lib/utils.ts` → `cn()` con `extendTailwindMerge` extendiendo el grupo `shadow` con
  `surface`/`raised`/`overlay` — sin esto, `tailwind-merge` no sabe que `shadow-surface` y
  `shadow-none` compiten entre sí.
- `components/ui/button.tsx` → el patrón de referencia para toda primitiva nueva.
- `components/shared/modal/` → stack global + portal, para que solo el modal superior pinte el
  backdrop cuando hay más de uno abierto.

## Tema claro/oscuro

`src/renderer/src/styles/globals.css` define **dos paletas físicas** (`--wa-*`, en `:root`/
`[data-theme="dark"]` y en `[data-theme="light"]`) mapeadas a **un solo set de tokens
semánticos** vía `@theme inline` (`--color-background`, `--color-primary`, etc.). Los componentes
solo referencian los tokens semánticos — nunca `--wa-*` directo — así el toggle de tema
(`settings.store.ts`, `data-theme` en `<html>`) no requiere tocar ningún componente.

Oscuro es el default (`DEFAULT_SETTINGS['ui.theme']` en `shared/types/settings.ts`) — pensado
para operarse en una cabina de proyección a oscuras, igual que la versión legacy.

## Inter self-hosted

`@fontsource-variable/inter`, importado en `main.tsx`/`projection.tsx`. Reemplaza el `@import`
de Google Fonts de la versión legacy — la app queda usable sin internet desde el primer render,
incluyendo en una iglesia sin conexión.

## Layout de la ventana de control

Igual estructura de 3 paneles que la legacy (`src/renderer/src/app/App.tsx`):

- **Izquierda**: `PlaylistPanel` (arriba) + `MediaLibraryPanel` (abajo).
- **Centro**: `Tabs` entre `PreviewPanel` y `BiblePanel`.
- **Derecha**: `LiveMonitorPanel` — espejo de baja fidelidad de `selectOutput()`.
- **Footer**: NEGRO / LOGO (togglean `overlay` en `projection.store`).

## `presentation.html` → `ProjectionApp.tsx`

Los mismos 6 tipos de contenido relevantes de la legacy (`black`, `logo`, `image`, `video`,
`bible`, `text`) más `slide` (una imagen ya rasterizada del deck). El tipo
`text` legacy no tenía ningún caller — acá sí lo tiene (`ServiceItemDTO` con `kind:'text'`), así
que dejó de ser una feature muerta.
