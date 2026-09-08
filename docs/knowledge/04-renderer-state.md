# 04 — Estado del renderer

El objeto global `state` (20 campos) y el mapa `els` de ~45 IDs hardcodeados desaparecieron. En
su lugar, **Zustand** en slices por dominio (`src/renderer/src/stores/`):

| Store | Qué guarda |
|---|---|
| `service.store.ts` | programa actual (`items`), `selectedIndex` (highlight), `activeIndex` (en vivo) |
| `preview.store.ts` | **qué se está mirando** (`target`: ítem del programa \| versículo \| asset de la biblioteca) + `slideIndex`, el cursor de preview independiente del de proyección |
| `projection.store.ts` | `base` (qué se eligió proyectar) + `overlay` ('none'\|'black'\|'logo') + `logoUrl` + `presentationOpen` |
| `bible.store.ts` | versión/libro/capítulo activos, versículos cargados, índice de versículo actual |
| `library.store.ts` | biblioteca de medios por tipo, pestaña activa, selección |
| `settings.store.ts` | espejo en memoria de la tabla `settings`, aplica `data-theme` al `<html>` |
| `display.store.ts` | pantallas disponibles, cuál está elegida (persistida en `settings['projection.displayId']`), `open()/close()` de la ventana de proyección |

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

`src/renderer/src/effects/end-of-playback.ts` saca solo del aire un video o un deck con
auto-avance que terminó de reproducirse por su cuenta, dejando la escena de logo
(`clearBaseContent()`) — la congregación nunca se queda mirando el último frame o la última
diapositiva porque el operador se olvidó de limpiar. Un deck se considera terminado cuando pasó a
`autoplay: "finished"` **y**, si tiene soundtrack, esa pista también reportó `ended` — lo que
termina último manda; una música más larga que la suma de los timings no se corta a mitad.
Ningún deck manual (sin `advanceAfterMs`) se auto-limpia nunca.

El punto que hay que respetar al tocar este archivo: `MediaStatus.ended` es *sticky* en el
elemento del DOM y se re-emite al montar (`use-media-status-reporter.ts` llama a `report()` sin
esperar un evento), y la pista del deck siempre reutiliza la misma clave
(`audio:deck-soundtrack`, `audio.store.ts`). Sin comparar `status.epoch` contra el epoch vigente
(`base.epoch` para el video, `soundtrackEpoch` para el deck), un `ended: true` de un video o deck
anterior podría limpiar el que está sonando ahora. Cualquier consumidor nuevo de `mediaStatus`
que mire `ended` tiene que hacer la misma comparación.

## Sincronización entre ventanas

El control es la única fuente de verdad; la ventana de proyección no tiene estado propio (ver
`01-architecture.md` sobre el replay en `did-finish-load`). No hay Context ni estado de React
compartido entre ventanas — son dos procesos de renderer distintos, la única vía es IPC.

## La capa de acciones

`lib/actions/` es donde vive todo lo que cruza stores, y está partida según el flujo de dos
etapas de EasyWorship:

- `preview.ts` — selección y cursor de preview. **No toca `projection.store` nunca.** Un click en
  el programa, en un versículo o en un asset termina siempre acá.
- `playback.ts` — `goLive()` es el **único** camino de preview a proyector, compartido por el
  botón EN VIVO, Enter, y el doble click en una fila, un tile o un versículo, así que los cuatro
  no pueden divergir. También `clearLive()` (LIMPIAR), `advanceSlide`/`gotoSlide` y
  `toggleOverlay`. Ordena las cosas para que un deck esté **listo antes** de cambiar `base`: darle
  EN VIVO a un `.pptx` sin convertir deja el proyector como está en vez de cortar a negro durante
  la conversión.
- `bible.ts` — `projectVerse`/`advanceVerse` (en vivo), `previewSearchHit` y
  `addVerseToSchedule`.

## Teclado

`use-global-shortcuts.ts`, con la división que hace que se puedan apretar sin mirar:

| Tecla | Qué mueve |
|---|---|
| ←/→ | **lo que está en vivo** — la diapositiva o el versículo en pantalla, derivado de `base` y no del panel enfocado |
| ↑/↓ | **el cursor de preview** — nada llega al proyector |
| Enter | manda el preview al proyector (`goLive()`) |
| Espacio | pausa/reanuda un deck con auto-avance — el atajo que hace falta para frenar en seco un PPT que se pasa solo |
| B / L | NEGRO / LOGO |
| Delete/Backspace | quita el ítem seleccionado (biblioteca antes que programa) |
