# Bugs de campo — reportados por el operador usando la app (2026-09-13)

**Fecha:** 2026-09-13 (novena sesión del proyecto)
**Origen:** no son hallazgos de lectura estática. Son **dos síntomas que el usuario vio usando la
app** después de aplicar la Tanda 1 de
[`2026-09-13-transversal-general.md`](2026-09-13-transversal-general.md), y que ninguna de las tres
auditorías previas había registrado.
**Alcance:** el diagnóstico de esos dos síntomas, su causa raíz y las opciones de arreglo.
**Base:** rama `fix/golive-race-and-live-audit`, árbol de trabajo actual.
**Método:** a diferencia de las auditorías anteriores, esta **sí levantó la app** — ambos bugs se
reprodujeron y se midieron por CDP contra la instancia real, con la biblioteca y los programas
guardados del usuario. Los números de abajo son medidos, no inferidos.
**Report-only: no se arregló nada.**

---

## 1. Resumen

| # | Severidad | Síntoma que reportó el operador | Causa raíz en una línea | Estado |
|---|---|---|---|---|
| `F1` | 🟠 Alto | Borrar un recurso desde "Usados recientemente", en cualquier tipo de media, muestra **el mismo toast 4 veces** | Un flag global de un solo uso (`blockedAssetId`) se consume en un `useEffect` de `MediaBrowser`, y desde el arreglo `M43` de la auditoría de la cadena de media **hay una instancia de `MediaBrowser` montada por cada pestaña visitada** | ✅ **cerrado 2026-09-14** (§8) |
| `F2` | 🟠 Alto | Pasar de un video a otro video en el proyector **no hace la disolvencia**: siempre pasa por negro | En una transición video→video el único `<video>` montado es el **entrante**, pero `videoRole` le asigna el papel de **saliente** — así que el video nuevo reproduce el fade-**out**, se va a negro y después salta a opacidad 1 | ✅ **cerrado 2026-09-14** (§8) |

Los dos son **regresiones de features que funcionan bien en el resto de los casos**, no huecos
estructurales: `F1` lo introdujo un arreglo de la auditoría anterior, y `F2` afecta exactamente una
de las cuatro combinaciones de transición (las otras tres se midieron y están correctas).

**Ninguno de los dos estaba en las 76 filas de la transversal general, ni en las 54 de la cadena de
media, ni en la de negro/logo.** Se buscó por síntoma (`toast`, `duplicad`, `blockedAssetId`) y por
área (`transition`, `crossfade`, `videoRole`) antes de escribir esto.

---

## 2. Leyenda

Misma que el resto de las auditorías del proyecto:

| Símbolo | Severidad | Criterio |
|---|---|---|
| 🔴 | Bloqueante | Puede dejar la app inutilizable o la proyección caída durante un culto |
| 🟠 | Alto | Pérdida de datos, un aviso que el operador no puede leer, o una decisión invisible que lo perjudica |
| 🟡 | Medio | Defecto real, trabajo desperdiciado, o una regla del propio proyecto incumplida |

---

## 3. 🟠 `F1` — El toast de "no se puede quitar" se repite una vez por pestaña de recursos visitada

### 3.1 Qué se ve

El operador selecciona un recurso en **Usados recientemente** (cualquier tipo: video, imagen, audio
o presentación), aprieta **Quitar**, y aparecen **cuatro toasts idénticos** apilados:

> No se puede quitar: se usa en un programa guardado.

### 3.2 Reproducción medida

Reproducido por CDP contra la app real, con la biblioteca y los 4 programas guardados del usuario:

```
5 paneles de recursos montados (Biblia + Videos + Imágenes + Audios + Presentaciones)
  → seleccionar "Milano Marathon (FINALE)" (asset 7, usado en un programa) → Quitar
  → { blockedToasts: 4, undoToasts: 0 }

recargar la ventana; visitar SOLO la pestaña Videos → 2 paneles montados
  → mismo asset, mismo botón
  → { blockedToasts: 1 }
```

**El número de toasts es exactamente el número de `MediaBrowser` montados.** No es un 4 mágico ni
un `MAX_TOASTS` capando algo mayor: es uno por instancia.

Y no depende del tipo de media, tal como lo reportó el operador: en su base, **los cuatro tipos
tienen assets usados por programas guardados** (`audio` 2, `image` 2, `ppt` 5, `video` 3), así que
el camino se dispara en cualquier pestaña.

### 3.3 Causa raíz

Dos piezas correctas por separado que dejaron de serlo juntas:

1. **`blockedAssetId` es un evento de un solo uso guardado en estado global.**
   `lib/actions/remove-asset.ts:130` llama `library.setBlockedAssetId(id)` cuando el asset está en
   uso, y el consumidor lo lee y lo apaga con `dismissBlocked()`.

2. **El consumidor es un `useEffect` dentro de `MediaBrowser`** (`media-browser.tsx:286-294`), un
   componente que hasta la cuarta sesión estaba montado **una sola vez** — `ResourcePanel`
   desmontaba la pestaña al cambiar de solapa.

`M43` de la auditoría de la cadena de media cambió eso a propósito y con buenas razones
(*"Cambiar de pestaña desmonta `MediaBrowser`: se pierden statuses, rango visible, posición de
scroll y `failedUrls`"* — commit `2d9417e`): ahora **las pestañas visitadas quedan montadas para
siempre**. El efecto del toast es de `5e5202a`, tres commits anterior, así que nunca vio ese mundo.

El apagado no salva nada, y esto es lo importante para el arreglo: `dismissBlocked()` es un `set()`
de Zustand, pero React ya despachó el mismo commit a las cuatro instancias. Las cuatro tienen
`blockedAssetId === id` capturado en su clausura, las cuatro corren su efecto, las cuatro empujan
su toast. Ninguna guarda contra la otra porque **ninguna sabe que la otra existe**.

### 3.4 Por qué es 🟠 y no 🟡

El síntoma visible es cosmético — el mensaje es correcto, sólo está cuatro veces. Lo que lo sube de
categoría es el efecto sobre el resto de los avisos:

`MAX_TOASTS = 4` (`stores/toast.store.ts:38`) y la política de desbordamiento es **retirar el más
viejo**. Cuatro toasts empujados de golpe **vacían la pila entera**: cualquier aviso que estuviera
en pantalla en ese momento — típicamente el `media.loadErrorToast` de "este archivo no se pudo
reproducir", que es el que menos puede perderse en pleno culto — desaparece sin que nadie lo haya
leído. Es literalmente el criterio 🟠 de este proyecto: *un aviso que el operador no puede leer*.

Además el mismo camino se dispara **7 segundos tarde**: si el rechazo llega en `commitRemoval`
(`remove-asset.ts:91`, el caso en que el operador guardó un programa que usa el asset durante la
ventana de deshacer), son otros cuatro toasts, esa vez sin ninguna acción del operador que los
explique.

### 3.5 Cómo se arregla

Tres opciones, de mejor a más barata:

| | Qué | Costo | Nota |
|---|---|---|---|
| **(a) recomendada** | **Empujar el toast desde la acción, no desde el componente.** `removeAsset` ya sabe `usages.length > 0` — puede llamar `toast.danger(...)` ahí mismo. Corre una vez por gesto del operador **por construcción**, sin importar cuántos componentes estén montados | La acción del toast (`Eliminar igualmente`) tiene que abrir `RemoveAssetConfirm`, que hoy es `useState` de `media-browser` (`confirmAssetId`). Hay que mover ese flag a `stores/ui.store.ts` | El precedente ya existe y está documentado en ese mismo archivo: `settingsOpen` vive ahí exactamente porque *"a toast action is a plain function with no component tree under it"* |
| (b) mínima | Dejar el flag y **consumirlo en un solo lugar**: `ResourcePanel` (montado una vez) o un módulo de `effects/` | Una sola instancia por construcción | No resuelve el problema de fondo — el flag sigue siendo un evento en forma de estado, y el próximo consumidor lo puede volver a duplicar |
| (c) parche | Deduplicar en `toast.store` por mensaje+tono dentro de una ventana corta | Barato | Esconde el síntoma y le miente a cualquier caso legítimo de dos toasts iguales seguidos |

**La regla general que conviene dejar escrita** (y que vale para todo el renderer, no sólo para
esto): *un evento de un solo uso guardado en un store global no puede consumirse en un efecto de un
componente que puede estar montado más de una vez.* Se barrió el resto de los `toast.*` del
renderer: los otros diez viven en acciones, stores o componentes de instancia única (`TopBar`,
`SchedulePanel`, `ProgramsModal`). **`blockedAssetId` es el único caso.**

---

## 4. 🟠 `F2` — Video → video no hace la disolvencia: el video entrante se funde a negro y después salta

### 4.1 Qué se ve

Con **Ajustes → Proyección → transición = disolvencia (`crossfade`, 300 ms)**, mandar EN VIVO un
video mientras hay otro video en el proyector no cruza los dos: la imagen se va a negro y vuelve.

### 4.2 Reproducción medida

Grabación por CDP **dentro de la ventana de proyección**, muestreando por `requestAnimationFrame`
el `animation-name`, la `opacity` computada y el `z-index` de cada `<video>` y de cada capa de
escena. Ajuste real del usuario en el momento de la medición: `crossfade`, `300 ms`.

**Video → video (roto):**

```
     0 ms | vid17  an=none          op=1.000  z=1     ← video A en régimen
  5641 ms | vid8   an=fade-out      op=1.000  z=0     ← A ya no está en el DOM; B monta … con el fade de SALIDA
  5757 ms | vid8   an=fade-out      op=0.690  z=0
  5841 ms | vid8   an=fade-out      op=0.232  z=0
  5908 ms | vid8   an=fade-out      op=0.024  z=0     ← el video NUEVO, casi invisible
  5974 ms | vid8   an=none          op=1.000  z=1     ← salto a plena opacidad
```

El corte a A es instantáneo (el elemento desaparece en el mismo frame), **B aparece a opacidad 1 y
se funde a negro durante ~270 ms**, y a los ~330 ms **salta** de golpe a opacidad 1. No hay cruce en
ningún momento: hay un corte, un fundido al revés y un salto.

**Las otras tres combinaciones se midieron en la misma sesión y están bien:**

| Transición | Medición | Veredicto |
|---|---|---|
| imagen → video | capa de la imagen `fade-out` 1→0 en `z=0`, `<video>` `fade-in` 0→1 en `z=2`, simultáneos (13906→14222 ms) | ✅ disolvencia real |
| video → imagen | el `<video>` se desmonta en el mismo frame; la capa de la imagen hace `fade-in` 0→1 sobre negro (9089→9456 ms) | ⚠️ corte + fundido de entrada — **limitación conocida y documentada** en el comentario de `OutputView`: el elemento se va con `videoUnderlay`, así que sus píxeles no pueden fundirse |
| **video → video** | ver arriba | ❌ **el bug** |
| deck/versículo → cualquier cosa | no medido en esta sesión; no involucra el `<video>` persistente | — |

### 4.3 Causa raíz

`OutputView` mantiene **un solo `<video>`**, fuera de las capas de escena y **keyed por
`videoUnderlay.epoch`** (`output-view.tsx:664`). Eso es deliberado y correcto: es lo que permite que
NEGRO/LOGO tapen un video sin desmontar el elemento (remontarlo repetidamente es lo que produce
`PIPELINE_ERROR_DECODE` — ver
[`worship-protocol-range-and-video-lifecycle.md`](../../.claude/knowledge/worship-protocol-range-and-video-lifecycle.md)).

Ese elemento único necesita saber de qué lado de la transición está, y eso lo decide `videoRole`
(`output-view.tsx:626-633`):

```ts
const videoRole: LayerRole =
  layers.length < 2 ? "steady"
  : layers[0]?.output.kind === "video" ? "leaving"     // ← se evalúa PRIMERO
  : layers[1]?.output.kind === "video" ? "entering"
  : "steady";
```

En una transición video→video **las dos ramas son verdaderas**, y gana la primera. Pero el elemento
que existe en el DOM no es el saliente: `videoEpoch += 1` en cada EN VIVO de un video
(`lib/actions/playback.ts:159`) re-keyea el componente, así que **el elemento montado es el
entrante** y recibe el papel del que ya se fue. Con `crossfade` eso es `wa-scene-fade-out` sobre él;
con `animation-fill-mode: both` se queda clavado en opacidad 0 hasta que la capa saliente se suelta,
y entonces vuelve a `steady` (opacidad 1) de un frame para el otro — el salto de los 5974 ms.

Las dos capas de escena, mientras tanto, **no pintan nada**: `opaque = output.kind !== "video"` es
`false` para ambas y `OutputScene` no dibuja nada para `kind: "video"`. El negro que se ve es el
`bg-black` del contenedor de `OutputView`, que queda expuesto cuando el video se apaga.

**No es exclusivo de la disolvencia.** Con `fade-through-black` el mismo papel `leaving` le aplica
`wa-scene-out-then-black` (se funde en la primera mitad y se queda en 0 hasta el final), así que el
salto es todavía más marcado. Y **tampoco hace falta cambiar de video**: como el epoch sube en cada
EN VIVO, volver a mandar en vivo **el mismo** video reproduce el bug igual.

El monitor EN VIVO muestra exactamente lo mismo (`mode === "monitor"` también anima), así que en
esto el monitor no le miente al operador — le muestra fielmente un defecto.

### 4.4 Cómo se arregla

| | Qué | Resultado | Costo |
|---|---|---|---|
| **(a) una línea** | Invertir el orden de `videoRole`: evaluar `layers[1]` (entrante) **antes** que `layers[0]` | El video nuevo entra con `fade-in` desde negro y ya no salta. **Sigue pasando por negro**, pero deja de estar al revés | Trivial, sin riesgo. Es el arreglo para *hoy* |
| **(b) recomendada** | **Congelar el último frame del video saliente en la capa saliente.** Al empezar la transición, dibujar el `<video>` que se va en un `<canvas>`/`ImageBitmap` y montar esa imagen en la capa que sale; la capa entrante queda transparente sobre el `<video>` nuevo | **Disolvencia real**, con **un solo decoder vivo** — que es justamente lo que la arquitectura actual protege | Medio. Hay que capturar el frame en el mismo commit en que llega el output nuevo, antes de que el elemento viejo se desmonte |
| (c) correcta y cara | Montar **dos** `<video>` durante la transición, uno por capa (cada `layer.output` ya trae su propio `videoUnderlay`) | Disolvencia real con movimiento en los dos lados | Dos decoders simultáneos durante `durationMs`, y hay que garantizar que el elemento persistente siga sin remontarse en un toggle de NEGRO/LOGO. Es exactamente el terreno del `PIPELINE_ERROR_DECODE` |

La opción (b) es la que respeta las dos invariantes que ya están escritas: un solo `<video>` vivo, y
la ventana de proyección como función pura del último `ProjectionOutput`. Un frame congelado durante
300 ms es, además, indistinguible de una disolvencia real a ojo — nadie percibe movimiento en la
mitad que se está yendo.

**Lo que no hay que hacer:** quitar el `key={epoch}` del `<video>` para "reusar el elemento entre
videos". Cambiar `src` en caliente sobre un elemento en reproducción es el patrón que ya causó
`PIPELINE_ERROR_DECODE (-12909)` en este proyecto.

---

## 5. Dónde entran en la prioridad de la transversal general

La §10 de [`2026-09-13-transversal-general.md`](2026-09-13-transversal-general.md) queda así con
estos dos adentro:

- **Tanda 2 (la semana siguiente)** — entran los dos:
  - `F2` opción (a), la línea de `videoRole`: es el arreglo más barato del backlog entero y saca de
    encima el artefacto más visible para la congregación.
  - `F1` opción (a): mover el toast a la acción, con el flag de confirmación a `ui.store`.
- **Tanda 3 (fuera de temporada)** — `F2` opción (b), la disolvencia real con el frame congelado.

Nada de esto desplaza a `H3`, `H2` ni `H5`, que siguen siendo lo primero de la Tanda 2.

---

## 6. Verificación

### 6.1 Ejecutada en esta sesión

```
app levantada con  npm run dev -- --remote-debugging-port=9222
F1  reproducido    5 paneles montados → 4 toasts · 2 paneles montados → 1 toast   ✅
F2  reproducido    grabación por rAF en la ventana de proyección, 720 muestras / 12 s   ✅
    control        imagen→video mide disolvencia real; video→imagen mide corte+fade-in   ✅
```

Barra mínima del proyecto, corrida sobre este árbol (no se tocó una línea de `src/`, así que es una
confirmación de que la Tanda 1 sigue verde, no de este trabajo):

```
npm run typecheck   ✅
npm run lint        ✅  0 errores, los mismos 5 warnings preexistentes de react-refresh
npm run db:smoke    ✅  15/15
```

La app se cerró al terminar. La única huella en los datos del usuario son las ~4 filas de
`projection_history` que deja proyectar cuatro veces (1809 filas en total) — es lo que la app
escribe cuando se la usa normalmente, no un efecto de la prueba.

### 6.2 Pendiente

1. `F1` — confirmar el camino tardío: borrar un recurso **no** usado, y guardar un programa que lo
   use dentro de los 7 s de la ventana de deshacer. Debería dar los mismos N toasts, esa vez sin
   ningún gesto del operador que los explique.
2. `F2` — repetir la medición con `fade-through-black` para confirmar el segundo síntoma derivado
   (afirmado por lectura del keyframe, no medido).
3. `F2` — medir deck→video y video→deck, que no se cubrieron.

---

## 7. Archivos citados

| Archivo | Qué hay ahí |
|---|---|
| `src/renderer/src/components/pages/resources/media-browser.tsx:286` | el efecto que consume `blockedAssetId` — `F1` |
| `src/renderer/src/components/pages/resources/ResourcePanel.tsx:40` | `visited`: las pestañas que quedan montadas (arreglo `M43`) — `F1` |
| `src/renderer/src/lib/actions/remove-asset.ts:130,91` | los dos emisores de `setBlockedAssetId` — `F1` |
| `src/renderer/src/stores/toast.store.ts:38` | `MAX_TOASTS = 4` y la expulsión del más viejo — `F1` |
| `src/renderer/src/stores/ui.store.ts` | el precedente para el arreglo (a) — `F1` |
| `src/renderer/src/components/shared/output-view.tsx:626` | `videoRole` — `F2` |
| `src/renderer/src/components/shared/output-view.tsx:664` | el `<video>` persistente y su `key={epoch}` — `F2` |
| `src/renderer/src/lib/actions/playback.ts:159` | `videoEpoch += 1` en cada EN VIVO — `F2` |
| `src/renderer/src/styles/globals.css:57-72` | los cuatro keyframes de escena — `F2` |

---

## 8. Estado — los dos cerrados (2026-09-14, décima sesión)

**Report-only sigue valiendo para el diagnóstico de arriba: esta sección es lo único que se agrega
después, y no reescribe nada.** Los dos se arreglaron y se verificaron contra la app real por CDP,
con la biblioteca y los programas del usuario.

### `F1` — opción (a): el toast se empuja desde la acción

`removeAsset` ya sabía `usages.length > 0`, así que ahora llama `toast.danger(...)` ahí mismo
(`offerForcedRemoval`, en `lib/actions/remove-asset.ts`): corre **una vez por gesto del operador por
construcción**, sin importar cuántos paneles estén montados. `blockedAssetId` /
`setBlockedAssetId` / `dismissBlocked` se borraron de `library.store`, y el flag del diálogo de
confirmación se movió a `stores/ui.store.ts` — el mismo precedente que `settingsOpen`.

La parte que el informe no anticipaba: **`RemoveAssetConfirm` también estaba montado una vez por
pestaña**. Aunque el toast fuera uno solo, el diálogo se habría abierto cinco veces. Se monta ahora
una única vez en `App.tsx`, y como el `assetMissing` que recibía por prop venía de `recentAssets`
—una fuente equivocada: el atajo Supr puede apuntar a una fila de carpeta vinculada que nunca estuvo
en `byKind`— el componente se lo pregunta a main junto con los usos.

**Medido:** 5 paneles de recursos montados, borrar el asset 7 (usado por 3 programas guardados) →
**1 toast** y **1 diálogo**, contra los 4 toasts del informe.

### `F2` — opción (b): la disolvencia real con el frame congelado

Se implementó la opción recomendada, no la de una línea. `videoRole` ahora pregunta primero por la
capa **entrante** (el elemento montado es siempre el del output que acaba de llegar), y el lado que
se va es un **still del último frame** del video saliente: `LiveVideo` lo entrega en la limpieza de
un `useLayoutEffect` —el único punto donde el elemento todavía tiene píxeles decodificados, porque
un efecto pasivo corre después de que el navegador ya pintó el cuadro sin él— y `OutputView` lo
cuelga de la capa saliente como un `<canvas>`.

**Medido en el monitor EN VIVO** (mismo `OutputView`; la ventana de proyección queda ocluida detrás
del control y no corre rAF). Video A epoch 1 → video B epoch 2, `crossfade` 300 ms, los dos
confirmados `kind: "video"` por `projection:getSnapshot`:

```
  27 ms | capa[FRAME 3840x2160] fade-out 1.000  ·  video fade-in 0.000
 159 ms | capa[FRAME 3840x2160] fade-out 0.614  ·  video fade-in 0.386
 309 ms | capa[FRAME 3840x2160] fade-out 0.009  ·  video fade-in 0.991
 349 ms | steady 1.000                          ·  video steady 1.000
```

Simultáneo, complementario, sin negro y sin salto — contra el `1.000 → 0.024 → salto a 1.000` del
§4.2. Un solo decoder vivo, que es la invariante que la arquitectura protege.

**De paso cierra la "limitación conocida" de la tabla de §4.2:** video → imagen también tiene ahora
píxeles reales para fundir, medido con el frame a 3840×2160 y a 640×360 según el video de origen.

### Lo que quedaba pendiente en §6.2

1. El camino tardío de `F1` (rechazo en `commitRemoval`, 7 s después) **ya no puede duplicarse**:
   pasa por el mismo `offerForcedRemoval`. No se reprodujo en la app.
2. `fade-through-black` **no se volvió a medir**. El papel invertido que lo hacía peor desapareció
   con el cambio de `videoRole`, pero es afirmación por lectura, no medición.
3. deck→video y video→deck **siguen sin medirse**.
