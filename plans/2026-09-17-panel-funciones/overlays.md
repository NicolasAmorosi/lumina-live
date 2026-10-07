# Overlays — placas guardadas sobre lo proyectado

**Fecha:** 2026-09-17
**Estado:** Fases 1, 2 y 3 entregadas (2026-09-24, sin commitear): zócalo, banner (fijo o en movimiento) y mosca, varias a la vez (una por clase), estilo y animación configurables, reordenables y duplicables en el modal «Placas», y auto-ocultado por placa. Verificadas contra la app real. Después, la quinta tanda: la placa pasa por preview → EN VIVO y es un ítem del programa.
**Depende de:** [`PLAN.md`](PLAN.md) — sus cinco reglas comunes. La excepción que declaraba (una
placa fuera del flujo de dos etapas) quedó revocada por la quinta tanda.

## Qué resuelve

La barra con el nombre del predicador sobre el video que está en vivo. Y, con la misma
maquinaria, un aviso corto y el logo de la iglesia en una esquina.

Una placa **no reemplaza lo proyectado: lo modifica**. Esa frase decide casi todo lo que sigue.

## Decisiones cerradas con el usuario (2026-09-17)

- **Placas guardadas y reutilizables**, en la base de datos. Se crean una vez, se editan y
  quedan para el próximo culto: el nombre del pastor no se vuelve a tipear cada domingo.
- **NEGRO y LOGO tapan la placa**, como tapan todo lo demás. NEGRO significa que la
  congregación no ve nada, sin una excepción que el operador tenga que recordar en pleno
  culto. Al destapar, la placa vuelve tal como estaba.

## Segunda tanda de decisiones (2026-09-24)

Cierran las cuatro «decisiones pendientes» de abajo y **reemplazan** lo que el modelo de
datos y las fases de arriba decían donde se contradigan.

| Tema | Decisión |
|---|---|
| Cuántas a la vez | **Varias desde el arranque, una por clase**: a lo sumo un lower-third y un bug (y un banner cuando exista). Mostrar otra placa de la misma clase **reemplaza** a la que estaba. `plate` pasa a ser `plates: ProjectionPlate[]` |
| Clases en la Fase 1 | **`lower-third` + `bug`**. El banner queda para la Fase 2 |
| El bug | **Imagen y/o texto**: una imagen de la biblioteca opcional y una línea de texto opcional al lado. Al menos una de las dos |
| Estilo | **Configurable por placa desde la Fase 1**: fondo de la franja (color o degradé, sin imagen), opacidad de la franja, fuente, `SceneTextStyle` de título y subtítulo, tamaño y opacidad de la imagen del bug, posición, **margen desde el borde** y **animación** |
| Animación | `none` \| `fade` \| `slide` + duración. «Deslizar» entra desde el borde vertical más cercano (abajo para las posiciones de abajo, arriba para las de arriba). Es propia de la placa, independiente de `SceneTransition` |
| Monitor de PREVIEW | Muestra **la placa seleccionada en la lista** (todavía no mostrada) sobre lo que esté en preview — nunca las que están en el aire. Sirve para chequearla antes de ponerla |
| Nada en vivo | La placa **no se dibuja** sobre el logo por defecto de «nada en vivo», igual que bajo LOGO. Queda marcada como mostrada y aparece apenas se manda algo EN VIVO |
| Auto-ocultado | Fase 3 — ver la cuarta tanda |

Consecuencias de implementación que ya quedan fijas:

- Las placas en el aire viven **resueltas** en `projection.store` (`livePlates`), como
  `base.scene` para una escena de tiempo: editar la placa que está en el aire la parchea en el
  lugar (`setLivePlate`) y el proyector la redibuja sin re-animarla.
- `sceneContentKey` ignora `plates`, y **el historial tampoco graba por un cambio de placas**:
  `HistoryRepo` deja de escribir una fila cuando lo único que cambió entre dos pushes es lo que
  no es contenido del culto.
- La animación de entrada/salida la maneja una capa propia en `OutputView`, con presencia
  local (la placa que sale se sigue dibujando hasta terminar su animación).

## Tercera tanda de decisiones (2026-09-24) — el banner

| Tema | Decisión |
|---|---|
| Qué es | Una franja de **ancho completo**, arriba o abajo, **fija o en movimiento** (un interruptor por placa, `style.ticker`) |
| Texto | Título + subtítulo, como el zócalo. Fijo: apilados y alineados según la posición (izq./centro/der.). En movimiento: **una sola línea continua en bucle**, sin cortes |
| Velocidad | Slider por placa, en `cqw` por segundo: la misma velocidad sea cual sea el largo del texto, y la misma en el proyector y en los monitores |
| Margen | En **los cuatro lados**, como el zócalo |
| Choque con zócalo/mosca | ~~**Se apilan**~~ — **revocado por la sexta tanda** (una placa por borde): en el borde de un banner, el zócalo y la mosca suben por encima de la franja. Es layout puro (una columna por borde, una celda de grilla compartida por nivel), sin medir nada |
| Reordenar | Solo en el modal «Placas». La lista de la pestaña es de operación: un arrastre accidental no cambia el orden en pleno culto |

~~Límite conocido: cuando el banner entra o sale, el zócalo que está encima salta.~~ Ya no
aplica: con una placa por borde no hay nada encima del banner.

## Cuarta tanda de decisiones (2026-09-24) — el auto-ocultado (Fase 3)

La animación configurable y «duplicar» ya habían entrado con las Fases 1 y 2; la Fase 3 fue
solo el auto-ocultado.

| Tema | Decisión |
|---|---|
| Dónde se configura | **Por placa, guardado**: `style.autoHide = { enabled, afterMs }` (2–120 s). Sin migración: es un campo más de `style_json`, normalizado al leer |
| Tapada | **La cuenta se pausa** bajo NEGRO, LOGO y «nada en vivo»: corre solo mientras la sala ve la placa |
| Indicador | La fila de la pestaña muestra **lo que le queda**, congelado mientras está tapada |
| Default | **Apagado** en todas, 10 s al encenderlo |

Cómo quedó: `projection.store.plateHideClocks` guarda un `TimerClock` countdown por placa en el
aire (el mismo modelo de Utilidades, pausado y reanudado con `holdClock`/`resumeClock`); no es
entrada de `selectOutput`, así que el proyector no se entera. Una placa sube siempre **held**, y
`effects/plate-auto-hide.ts` llama a `tickPlateClocks` ante cada cambio de relojes, overlay o
`base`, y una vez más cuando vence la cuenta más próxima. Editar una placa en el aire conserva la
cuenta, salvo que el cambio sea del auto-ocultado mismo, que la reinicia.

## Quinta tanda de decisiones (2026-09-24) — mandar en vivo y el programa

El usuario probó las Fases 1–3 y marcó dos problemas: el MOSTRAR del pie del panel no se
encontraba ni se entendía, y una placa no se podía planificar en el orden de culto. Esto
**reemplaza** la «excepción de Overlays» de `PLAN.md` y la sección «La interfaz» de abajo.

| Tema | Decisión |
|---|---|
| Seleccionar | Una placa es **un target de preview** (`{ kind: "plate" }`) como cualquier recurso. El monitor PREVIEW la dibuja **sobre lo que está EN VIVO** (con las otras placas en el aire, y reemplazando la de su clase), no sobre negro ni sobre otro preview. Un video en vivo se muestra con su miniatura: no se decodifica una tercera copia |
| Mandar en vivo | La fila bajo el PREVIEW (`PlateTrackRow`, sobre `MediaTrackRow`) tiene su propio **EN VIVO**, que pasa a **Ocultar** cuando la placa está arriba. EN VIVO de la barra, Enter y doble click hacen lo mismo: todos son `goLive()` |
| Programa | `program_items.kind = 'plate'` con `overlay_plate_id` FK `restrict` (migración `0015`, a mano como la `0011`). Arrastrar la fila al programa o «Agregar al programa» en el pie. Borrar una placa usada pide confirmación con la lista de programas (`overlay:usages`) |
| Riel del programa | **Se queda en el contenido**: mandar una fila-placa no mueve `activeIndex`. La fila de la placa muestra su propio «En el aire»/«Tapada» (`PlateAirStatus`) |
| Panel EN VIVO | Una fila por placa arriba: nombre, cuenta del auto-ocultado, «tapada» y la X que la baja |
| NEGRO/LOGO | EN VIVO sobre una placa **no** los levanta: la placa sube tapada, y la fila lo dice |
| Live intent | Subir una placa **no** cancela un deck que todavía se está convirtiendo |

## Sexta tanda de decisiones (2026-09-24) — pulido tras probarlo

| Tema | Decisión |
|---|---|
| Choque | **Una placa por borde** (arriba una, abajo una), además de una por tipo. Mandar EN VIVO una placa **reemplaza** a la que ocupaba su borde — nunca se bloquea. La regla vive en un solo lugar, `platesCollide` (`shared/types/overlay.ts`), y la usan `showPlate`, `setLivePlate`, el monitor PREVIEW y la vista previa del editor |
| `EdgeStack` | Sin tiers: una sola celda por borde, donde la placa que sale y la que entra se cruzan en el lugar |
| Riel rojo | La lista de la pestaña no pinta el riel `bg-on-air` (`rail={false}`, como Utilidades); queda el badge «En el aire»/«Tapada» |
| Botones del editor | Una fila de **solo íconos** bajo «Nueva», en la columna de la lista (`EditorActions`, compartido con «Escenas»): Guardar (`primary`), Deshacer, Duplicar, Eliminar (`outline`, «Eliminar» en el extremo opuesto a «Guardar»). Duplicar/Eliminar se deshabilitan en un borrador sin guardar en vez de ocultarse, para que la fila no se reacomode. La vista previa vuelve a estar centrada, sola en `EditorHeader` |

---

## Modelo de datos

Tabla nueva `overlay_plates`, con su migración Drizzle (`npm run db:generate`) y su repo en
`src/main/db/repositories/overlays.repo.ts`:

| Columna | Uso |
|---|---|
| `id` | Identidad; es lo único que viaja en el estado |
| `name` | Cómo la encuentra el operador en la lista: «Pastor Juan Pérez» |
| `kind` | `lower-third` \| `banner` \| `bug`. Cerrado, no un string libre: cada uno es un layout distinto en el proyector |
| `title` | Línea principal |
| `subtitle` | Línea secundaria, nullable (el cargo, la referencia) |
| `position` | `bottom-left` \| `bottom-center` \| `top-right`… Válidas según `kind` |
| `sort_order` | Orden manual de la lista, como `programs` |
| `created_at`, `updated_at` | Auditoría básica |

Canales IPC `overlay:list`, `overlay:create`, `overlay:update`, `overlay:delete`, `overlay:reorder`
— una línea en `src/shared/ipc/contract.ts` y su entrada en `Handlers` cada uno, con
`/add-ipc`. El preload no se toca.

**Sin `dangerouslySetInnerHTML`, nunca**, y acá importa de verdad: el texto lo escribe el
usuario y termina dibujado en el proyector. Es texto plano en un `<p>`, y punto.

---

## Cómo llega al proyector

### El campo nuevo

`ProjectionOutput` gana un hermano de `videoUnderlay`:

```ts
/** La placa que el proyector tiene que sostener encima de la escena. Viaja
 *  RESUELTA (el texto, no el id) por la misma razón que `videoUnderlay` lleva
 *  la url: la ventana de proyección no consulta nada. */
export type ProjectionPlate = {
  id: number;
  kind: PlateKind;
  title: string;
  subtitle: string | null;
  position: PlatePosition;
  /** Cambia sólo cuando el operador muestra una placa distinta — es lo que
   *  dispara la animación de entrada sin re-montar en cada cambio de
   *  diapositiva. */
  epoch: number;
} | null;
```

Va **en el output, no en un canal aparte**, por lo mismo que `videoUnderlay`: tiene que
sobrevivir a cada cambio de diapositiva, a cada push, y al *snapshot* que
`main/services/projection-state.ts` replica cuando la ventana se reconstruye. Un comando se
perdería en todos esos casos y dejaría al operador con un panel que dice «placa visible» y una
pantalla que no la tiene.

### Cómo la tapa NEGRO

En el store vive `activePlateId: number | null`; `selectOutput` hace:

```ts
plate: state.overlay === "none" ? resolvePlate(state.activePlateId) : null
```

Es la misma forma que ya tiene el deck debajo de NEGRO: el estado se conserva, la proyección
no lo muestra, y al soltar el overlay reaparece sin que nadie tenga que acordarse de
re-mostrarlo. Que el elemento se desmonte no cuesta nada — es texto, no un `<video>` con una
sesión de decodificación por hardware detrás.

### Las dos trampas

1. **`sceneContentKey` tiene que ignorar `plate`.** Hoy serializa el output entero menos
   `transition`, así que mostrar una placa contaría como escena nueva y dispararía la
   disolvencia de **toda** la escena — el video de fondo se fundiría consigo mismo porque
   alguien puso un nombre en pantalla. La placa se excluye de esa clave igual que `transition`.
2. **Mostrar una placa no llama a `beginScene()`.** No es una escena nueva, y bumpear el epoch
   tendría el mismo efecto que el punto anterior por el otro camino.

### Dónde se dibuja

En `OutputView`, **fuera de la pila de capas de escena** y dentro del contenedor que define el
`container-query`, para que los tamaños en `cqw` valgan igual en el proyector y en los dos
monitores. Su propia animación de entrada/salida, atada a `plate.epoch`, independiente de
`SceneTransition`.

Los monitores la muestran porque usan el mismo componente. Eso no se negocia: si el monitor
LIVE no mostrara la placa, mentiría sobre lo que está viendo la congregación.

---

## La interfaz

`functions-tabs.tsx` deja de mostrar el placeholder de Overlays y monta `overlays-panel.tsx`:

- La lista de placas guardadas (`ListRow`, como los programas), con la que está en el aire
  marcada con el token `bg-on-air` — el mismo que usa el monitor LIVE, que para eso está
  reservado.
- Pie con: MOSTRAR / OCULTAR (la acción inmediata), nueva, editar, eliminar.
- El formulario de alta/edición, en un `Modal`, con una vista previa de la placa sobre una
  miniatura de lo que está en vivo.

**Un click en la lista selecciona, no muestra.** «Seleccionar nunca proyecta» se sostiene
incluso acá, donde no hay dos etapas: la acción de poner en pantalla es siempre un botón
aparte, nunca el mismo gesto que elegir.

---

## Fases

### Fase 1 — El camino completo con una sola clase de placa

Tabla, repo, IPC, `ProjectionPlate` en el output, el `lower-third` dibujado, y el panel con
lista + mostrar/ocultar. Sin editor: las placas se crean con un formulario mínimo (nombre,
título, subtítulo).

**Gate:** mostrar y ocultar una placa sobre un video en vivo **no puede producir ningún
parpadeo del video**. Si parpadea, la trampa 1 o la 2 siguen ahí y no se sigue adelante.

### Fase 2 — Las otras dos clases y las posiciones

`banner` y `bug`, con sus posiciones válidas por clase. Reordenar la lista.

### Fase 3 — Refinamiento

Animación de entrada/salida configurable, auto-ocultado a los N segundos (que es un timer y
debería reusar lo de [`utilidades.md`](utilidades.md), no inventar otro), y duplicar una placa.

---

## Criterios de aceptación

- Una placa creada en un culto sigue estando la semana siguiente, sin volver a escribirla.
- Mostrarla sobre un video no interrumpe el video ni dispara la transición de escena.
- NEGRO la tapa junto con todo lo demás; al destapar vuelve exactamente igual.
- Cambiar de diapositiva con una placa visible no la re-anima.
- Cerrar y reabrir la ventana de proyección la restaura.
- El monitor LIVE la muestra; el PREVIEW muestra la de su propia previsualización.
- Eliminar la placa que está en el aire la saca del proyector primero, y avisa.
- El historial de proyección no gana filas por mostrar placas.

---

## Decisiones pendientes (para la próxima tanda de preguntas)

1. **¿Una placa a la vez, o varias?** Un `bug` de logo permanente **más** un lower-third que va
   y viene es un caso real, y cambia `plate` de un objeto a una lista. Recomendación: una sola
   en la Fase 1, y decidirlo antes de la Fase 2 (el usuario ya mencionó el logo permanente como
   una variante que le interesaba).
2. **¿Se va sola?** Un auto-ocultado a los N segundos evita la placa olvidada en pantalla, pero
   agrega un temporizador que también hay que pausar, replicar y sostener.
3. **Tipografía y tamaño:** ¿fijos por la identidad de la iglesia, o configurables por placa?
4. **¿La placa se ve sobre una entrada externa** (pestaña Entradas) el día que exista? El plan
   de fuentes externas la trata como contenido base, así que debería, pero conviene decirlo
   cuando ese adaptador esté.
