# 04 — Estado del renderer

El objeto global `state` (20 campos) y el mapa `els` de ~45 IDs hardcodeados desaparecieron. En
su lugar, **Zustand** en slices por dominio (`src/renderer/src/stores/`):

| Store | Qué guarda |
|---|---|
| `program.store.ts` | programa actual (`items`, nombre, notas, fecha), `selectedIndex` (highlight), `activeIndex` (en vivo), `dirty` |
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

### `selectOutput` pierde información, y eso define qué puede decidir main

Mirando las tres primeras líneas de arriba: con un deck como `base`, NEGRO devuelve
`{kind:"black"}` y LOGO devuelve `{kind:"logo"}` — el `deckAssetId` no viaja. Y `base === null`
devuelve **también** `{kind:"logo"}`. Es decir: "hay un deck en vivo, tapado" y "no hay nada en
vivo" llegan a main como el mismo valor.

`ProjectionOutput` es todo lo que main tiene (`services/projection-state.ts`), así que main **no
puede** responder "qué está en vivo". La única excepción es `videoUnderlay`, y sobrevive al overlay
porque el proyector mismo lo necesita para no desmontar el `<video>`, no porque main lo pidiera.

De ahí salen dos reglas:

- Una decisión de main sobre contenido en vivo solo es correcta si el dato viaja dentro del output
  por una razón que la ventana de proyección necesita. Si no, la decisión es del control
  (`lib/actions/*`), que lee `base` y `overlay` directamente — es el caso del guard que rechaza
  reconvertir el deck que está en el proyector (`lib/actions/deck.ts`).
- Lo que main sí puede hacer es **no soltar** lo que ya sabía: `projection:show` mantiene el pin de
  desalojo del deck a través de NEGRO/LOGO y lo libera recién con un output que de verdad reemplaza
  el contenido.

Diagnóstico completo en
[`.claude/knowledge/main-cannot-know-what-is-live-under-an-overlay.md`](../../.claude/knowledge/main-cannot-know-what-is-live-under-an-overlay.md).

## La capa de efectos

`src/renderer/src/effects/projection-sync.ts` conecta el store con main: se suscribe a
`selectOutputMemo` y manda cada output por `projection:show`, y enchufa los eventos entrantes
(`media-status`, `media-error`, `deck-progress`). La danza del overlay de PowerPoint que vivía acá
**ya no existe** — las diapositivas son imágenes, la ventana de proyección nunca se esconde.

`selectOutput` devuelve un objeto nuevo en cada llamada y `preload` lo hace anidado, así que
`selectOutputMemo` memoiza la identidad en **un solo lugar**; sin eso, cada consumidor necesitaba
su propio parche para el mismo problema (un `equalityFn` con `JSON.stringify` acá, un `useShallow`
en `LiveMonitorPanel` allá).

La memoización compara **por referencia los 8 campos que `selectOutput` lee**, no el resultado
serializado. Es la diferencia entre O(1) y construir-más-serializar el output entero en cada
notificación del store — y quien más notifica, de lejos, es `setMediaStatus` (~4 Hz por elemento
sonando), que no afecta a ninguno de esos 8 campos. Como todos se reemplazan de forma inmutable,
comparar referencias es correcto; y de paso dos estados que difieren solo en `mediaStatus` dan la
misma tupla, así que dos suscriptores no pueden pelearse el slot único (el patrón que React
documenta como causa de bucles con `useSyncExternalStore`).

### Errores del proyector

`mediaErrors` (en `projection.store.ts`, indexado por `mediaErrorKey`: `"scene"`, `"video"`,
`"audio:<id>"`) guarda lo que la ventana de proyección reportó que no pudo cargar o decodificar.
Dos reglas que lo mantienen honesto sin ningún timer ni limpieza explícita:

- **Una entrada solo se muestra mientras su `url` siga siendo lo que está en vivo.** Pasar a la
  diapositiva siguiente o mandar otra cosa al aire la vuelve invisible sola.
- **`beginScene()` borra las entradas de `scene` y `video`.** Es lo que hace que volver a mandar el
  *mismo* archivo sea un reintento de verdad, en vez de arrastrar el aviso de un archivo que el
  operador ya repuso. Las de audio no: esas pertenecen al ciclo de vida de la lista de pistas y las
  retira `pruneMediaStatus`, en la misma pasada que los `mediaStatus` muertos.

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
