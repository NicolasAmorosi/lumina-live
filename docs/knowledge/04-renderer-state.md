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

## La capa de efectos — lo que no es puramente declarativo

`src/renderer/src/effects/projection-effects.ts` es el único lugar con lógica de "orden
importa": la danza del overlay de PowerPoint (mostrar/ocultar la ventana de proyección
alrededor de un cambio hacia/desde `{kind:'ppt'}`) y pausar/reanudar el audio vinculado durante
NEGRO/LOGO. Se suscribe a `selectOutput` con `subscribeWithSelector` de Zustand y diffea
`previous` vs. `next` — todo lo demás sobre "qué se ve" es la función pura de arriba.

## Sincronización entre ventanas

El control es la única fuente de verdad; la ventana de proyección no tiene estado propio (ver
`01-architecture.md` sobre el replay en `did-finish-load`). No hay Context ni estado de React
compartido entre ventanas — son dos procesos de renderer distintos, la única vía es IPC.

## Teclado

Pendiente (ver `07-roadmap-and-debt.md`): la legacy solo bindeaba Delete/Backspace. Se dejó como
mejora futura agregar flechas para avanzar slide/versículo — no bloqueaba la paridad funcional.
