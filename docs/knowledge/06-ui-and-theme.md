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

## Tema claro/oscuro y paleta oficial adventista

`src/renderer/src/styles/globals.css` define **dos paletas físicas** (`--wa-*`, en `:root`/
`[data-theme="dark"]` y en `[data-theme="light"]`) mapeadas a **un solo set de tokens
semánticos** vía `@theme inline` (`--color-background`, `--color-primary`, etc.). Los componentes
solo referencian los tokens semánticos — nunca `--wa-*` directo — así el toggle de tema
(`settings.store.ts`, `data-theme` en `<html>`) no requiere tocar ningún componente.

Los valores salen del **sistema de identidad oficial de la Iglesia Adventista**. `adventist.design`
y `styleguide.adventist.io` bloquean el acceso automatizado (403), así que la fuente usable es
**ALPS** (Adventist Living Pattern System, `github.com/adventistchurch/alps`), que es la
implementación de referencia de esa identidad —
`src/documentation/core/colors/_config.tsx` tiene cada color con su hex, RGB, CMYK y Pantone:

| Familia | darker / dark / base / light / lighter |
|---|---|
| Denim (primaria acá) | `#04132b` · `#04132b` · `#2f557f` · `#2e6de7` · `#84adfc` |
| Bluejay | `#052252` · `#2f557f` · `#2e6de7` · `#84adfc` |
| Campfire `#cd4900`, Iris `#9013fe`, Ming `#007f98`, Tree Frog `#2b8500`, Forest `#355724`, Cave `#255760`, Emperor `#4b207f`, Scarlett `#d0021b` |
| Neutros | `#000` `#222222` `#4a4a4a` `#717171` `#f5f5f5` `#ffffff` |

Dos consecuencias que importan al tocar la paleta:

1. **ALPS no define superficies de UI oscura** (es un sistema web/print). El tema oscuro
   **interpola la rampa Denim** entre `#04132b` y `#2f557f` en lugar de inventar matices nuevos.
   Cualquier valor nuevo tiene que salir de esa rampa o de un color de la tabla.
2. **No hay paleta global oficial de "colores de estado"** más allá de los de la tabla: el rojo es
   Scarlett, el verde es Tree Frog (oscuro) / Forest (claro). El token `--color-on-air` (Scarlett)
   tiene **un solo significado reservado**: esto está en el proyector ahora mismo. No se usa para
   errores — eso es `--color-danger`.

Los badges por tipo de contenido también son colores de la tabla (ppt = Campfire, video = Iris /
Emperor, image = Tree Frog / Forest, audio = Ming / Cave, bible = Bluejay / Denim).

Oscuro es el default (`DEFAULT_SETTINGS['ui.theme']` en `shared/types/settings.ts`) — pensado
para operarse en una cabina de proyección a oscuras, igual que la versión legacy.

## Noto Sans self-hosted

**Noto Sans es la tipografía oficial de la iglesia** (Advent Sans es exclusiva de logos y
señalética, por eso no se usa acá). Se sirve desde `@fontsource-variable/noto-sans`, importado en
`main.tsx`/`projection.tsx` — no hay `@import` de Google Fonts: la app queda usable sin internet
desde el primer render, incluyendo en una iglesia sin conexión.

## Layout de la ventana de control — EasyWorship 2009

`components/pages/layout/AppShell.tsx` es el workspace completo, calcado de EasyWorship 2009:

```
┌ TopBar (grid-cols-3, igual que el main de abajo) ──────────────────────┐
│ ⚙ · Servicios · culto        │        ▷ EN VIVO │ LOGO · NEGRO · ▷ EN VIVO│
├───────────────┬──────────────┴────────┬─────────────────────────────────┤
│ PROGRAMA      │                       │  EN VIVO                        │
│ (schedule)    │      DIAPOSITIVAS     │  (+ transporte deck)            │
│───────────────│   del ítem en preview │  (+ tira de diapositivas live)  │
│ RECURSOS      │                       │──────────────────────────────── │
│ Biblia|Vid|   │                       │  VISTA PREVIA                   │
│ Img|Aud|PPT   │                       │                                 │
└───────────────┴───────────────────────┴─────────────────────────────────┘
```

El `TopBar` es un **grid de 3 columnas idéntico al del `<main>`** de abajo (`grid-cols-3`), así
cada grupo de controles queda exactamente arriba de la columna sobre la que actúa, no importa el
ancho de la ventana:

- **Columna 1** (arriba de Programa/Recursos): el ícono de engranaje (Configuraciones), el botón
  Servicios y los badges de culto/cantidad de ítems.
- **Columna 2** (arriba de Diapositivas): un único botón **EN VIVO** que llama a
  `lib/actions/playback.ts::goLive()` — manda lo que está en vista previa al proyector,
  reemplazando lo que hubiera. Es la única forma de cruzar de preview a vivo; no hay un segundo
  botón equivalente en ningún otro lado.
- **Columna 3** (arriba de Monitores): tres botones mutuamente excluyentes — **LOGO**, **NEGRO**,
  **EN VIVO** — que llaman a `setOverlay('logo'|'black'|'none')` **directamente** (no
  `toggleOverlay`: cada uno siempre fuerza su propio estado, nunca "des-marca" al tocarlo de
  nuevo). Son los tres estados posibles de lo que el proyector muestra por encima del contenido
  base. Los atajos de teclado B/L siguen usando `toggleOverlay` (comportamiento sin cambios).

Las tres columnas del `<main>` son **`grid-cols-3`** — anchos iguales, ninguna de las tres tareas
(explorar, montar, emitir) pesa visualmente más que las otras. No hay StatusBar ni indicador de
"proyector conectado/desconectado" en el TopBar — LIMPIAR, la selección de pantalla y abrir/cerrar
la proyección, el tema claro/oscuro y el logo se movieron todos a
`pages/settings/SettingsModal.tsx`, detrás del ícono de engranaje que reemplaza el título de la
app. Esa modal sigue una única regla: **una configuración por fila, etiqueta a la izquierda y
control(es) a la derecha, siempre en la misma línea** (`SettingsRow`, local al archivo — no vale
la pena subirlo a `shared/` por una sola pantalla que lo usa).

`go-live-bar.tsx` no existe más: el `EN VIVO` que antes vivía entre los monitores LIVE y PREVIEW
ahora es el botón de la columna 2 del TopBar, y por eso las flechas de paginado de preview que
tenía (↑/↓ manual) tampoco existen — la columna central ya permite clickear cualquier diapositiva
o versículo, y las flechas del teclado (↑/↓, atajo global) cubren lo mismo.

### Pantalla y arranque de la proyección

`stores/display.store.ts` reemplaza al viejo hook `use-displays.ts`: lista las pantallas, resuelve
cuál usar (la persistida en `settings['projection.displayId']`, si sigue conectada; si no, la
primera no-primaria) y expone `open()/close()`. La app llama `open()` automáticamente al arrancar
(`app/App.tsx`) — **la ventana de proyección se abre sola y arranca en NEGRO**, nunca mostrando el
último contenido de un culto anterior. El operador corta/reinicia desde Configuraciones, no
manualmente desde el TopBar.

- **`schedule/`**: el orden del culto. Click = preview, doble click = en vivo, drag = reordenar.
- **`resources/`**: un solo browser con pestañas para **todo** lo proyectable, Biblia incluida
  (`variant="folder"` de `Tabs`). Un asset se puede previsualizar y proyectar sin estar en el
  programa — eso es lo que hace el área de recursos de EW.
- **`slides/`**: la grilla de lo que el ítem en preview puede poner en pantalla — diapositivas de
  un deck, versículos de un capítulo, o el propio archivo si es uno solo. Es también el único
  lugar que dispara conversiones (`useDeck`). `SlideGrid` (`slide-grid.tsx`) tiene dos variantes:
  `flow` (auto-fill, para versículos/asset único) y `fixed-2` (siempre 2 columnas, la que usa
  `deck-slides.tsx` para que las diapositivas de un PPT se vean grandes en vez de una grilla
  chica de N columnas).
- **`monitors/`**: LIVE arriba, PREVIEW abajo, ambos con la primitiva `Monitor`. Cuando lo que
  está en vivo es un deck (`base.kind === 'deck'`), el footer del monitor LIVE apila dos cosas:
  `deck-transport.tsx` (play/pausa/reiniciar el auto-avance) y `live-slide-strip.tsx` — una tira
  horizontal con las miniaturas de **todas** las diapositivas del deck en vivo; click en cualquiera
  llama `gotoSlide()` y salta ahí al instante (esto es vivo, no preview: no hay una segunda
  etapa). Es un componente distinto de `deck-slides.tsx`, que navega el deck *en preview*, no el
  que está en el aire.

### Flujo de dos etapas (estricto)

Seleccionar **nunca** proyecta. `lib/actions/preview.ts` mueve el target de preview y
`lib/actions/playback.ts::goLive()` es el único camino a `projection.store`. El cursor de preview
(`stores/preview.store.ts`) es independiente del cursor en vivo, así que se puede armar la
diapositiva 7 mientras la 3 sigue en pantalla.

Los atajos siguen la misma división: ←/→ mueven **lo que está en vivo**, ↑/↓ mueven **el
preview**, Enter cruza de uno al otro.

### `OutputView`, la primitiva que impide que un monitor mienta

`components/shared/output-view.tsx` renderiza un `ProjectionOutput` y lo usan **los tres**
lugares donde se ve contenido: la ventana de proyección (`mode="live"`) y los monitores LIVE y
PREVIEW (`mode="monitor"`). Los tamaños de texto están en `cqw` sobre un contenedor (`@container`),
no en `vw`, así que el mismo markup escala de un monitor de 240px a un proyector 4K sin variantes.
El monitor de preview es literalmente el renderer de proyección alimentado con otro input
(`lib/hooks/use-preview.ts::usePreviewOutput`).

## `presentation.html` → `ProjectionApp.tsx`

Los mismos 6 tipos de contenido relevantes de la legacy (`black`, `logo`, `image`, `video`,
`bible`, `text`) más `slide` (una imagen ya rasterizada del deck). El tipo
`text` legacy no tenía ningún caller — acá sí lo tiene (`ServiceItemDTO` con `kind:'text'`), así
que dejó de ser una feature muerta.
