# 04 — Estado del renderer

El objeto global `state` (20 campos) y el mapa `els` de ~45 IDs hardcodeados desaparecieron. En
su lugar, **Zustand** en slices por dominio (`src/renderer/src/stores/`):

| Store | Qué guarda |
|---|---|
| `service.store.ts` | playlist actual (`items`), `selectedIndex`, `activeIndex` — reemplaza la parte "playlist" de `state` |
| `projection.store.ts` | `base` (qué se eligió proyectar) + `overlay` ('none'\|'black'\|'logo') + `logoUrl` + `presentationOpen` |
| `bible.store.ts` | versión/libro/capítulo activos, versículos cargados, índice de versículo actual |
| `library.store.ts` | biblioteca de medios por tipo, pestaña activa, selección |
| `settings.store.ts` | espejo en memoria de la tabla `settings`, aplica `data-theme` al `<html>` |

Cada store toca solo lo que le corresponde — el polling de PPT (antes cada 800ms sobre el
`state` global entero) ya no re-renderiza componentes que no leen ese slice.

## `selectOutput` reemplaza `restorePrevious()`

El árbitro legacy (`app.js:408-418`, prioridad hardcodeada PPT > video > imagen > biblia > logo)
desaparece. `projection.store.ts` expone:

```ts
function selectOutput(state): ProjectionOutput {
  if (state.overlay === "black") return { kind: "black" };
  if (state.overlay === "logo") return { kind: "logo", url: ... };
  if (state.base === null) return { kind: "logo", url: ... };
  switch (state.base.kind) { /* exhaustivo — TS obliga a manejar cada variante */ }
}
```

Salir de NEGRO/LOGO es `setOverlay('none')` — no hay nada que "restaurar", porque `base` ya *es*
lo último elegido. Agregar un tipo de contenido nuevo a `BaseContent`
(`shared/types/projection.ts`) sin manejarlo en el `switch` es un **error de compilación**, no un
bug de "se quedó mostrando el logo" descubierto en producción.

## La capa de efectos

`src/renderer/src/effects/projection-sync.ts` conecta el store con main: se suscribe a
`selectOutputMemo` y manda cada output por `projection:show`, y enchufa los eventos entrantes
(`media-status`, `deck-progress`). La danza del overlay de PowerPoint que vivía acá **ya no
existe** — las diapositivas son imágenes, la ventana de proyección nunca se esconde.

`selectOutput` devuelve un objeto nuevo en cada llamada y `preload` lo hace anidado, así que
`selectOutputMemo` memoiza la identidad en **un solo lugar**; sin eso, cada consumidor necesitaba
su propio parche para el mismo problema (un `equalityFn` con `JSON.stringify` acá, un `useShallow`
en `LiveMonitorPanel` allá).

`src/renderer/src/effects/deck-autoplay.ts` es lo único con lógica temporal. Dos modos:

- **synced**: mientras hay soundtrack y nadie tocó nada, el índice de diapositiva es una función
  del tiempo del `<audio>`. Cada `media-status` re-deriva qué slide corresponde y re-arma un único
  `setTimeout` — el timer es una optimización de latencia, no el reloj, así que una pista de diez
  minutos no puede acumular deriva.
- **detached**: apenas el operador navega a mano, la música **sigue donde estaba** (decisión de
  producto) y el auto-avance continúa con una cadena de deadlines monotónica desde la diapositiva
  elegida. Un `navEpoch` incremental descarta cualquier `media-status` en vuelo para que una
  respuesta tardía no pise la diapositiva recién elegida.

## Sincronización entre ventanas

El control es la única fuente de verdad; la ventana de proyección no tiene estado propio (ver
`01-architecture.md` sobre el replay en `did-finish-load`). No hay Context ni estado de React
compartido entre ventanas — son dos procesos de renderer distintos, la única vía es IPC.

## Teclado

`use-global-shortcuts.ts`: Delete/Backspace (quitar), ←/→ (versículo o diapositiva según la
pestaña), **Espacio** (pausar/reanudar un deck que se pasa solo — el atajo que hace falta para
poder frenar en seco un PPT con auto-avance), B/L (NEGRO/LOGO) y Enter (EN VIVO).
