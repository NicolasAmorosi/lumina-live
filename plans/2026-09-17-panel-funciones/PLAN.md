# Panel de Funciones — plan del área

**Fecha:** 2026-09-17
**Estado:** interfaz entregada (commit `c8a47c0`); las tres funciones, sin implementar.

La primera columna de abajo pasó de cinco pestañas planas a tres con un segundo nivel:

```
┌──────────┬─────────┬───────────┐
│  Biblia  │  Media  │ Funciones │   ← qué clase de cosa
├──────────┴─────────┴───────────┤
│ Utilidades  Entradas  Overlays │   ← cuál
└────────────────────────────────┘
```

**Biblia** y **Media** ya existían y no cambiaron por dentro: se movieron. **Funciones** es
nueva y agrupa lo que puede ir al proyector sin ser un archivo de la biblioteca ni un
versículo. Hoy sus tres pestañas muestran qué va a hacer cada una y una insignia «En
desarrollo»; este documento es el plan para llenarlas.

| Pestaña | Qué es | Plan |
|---|---|---|
| Utilidades | Cuenta regresiva, reloj y cronómetro proyectables | [`utilidades.md`](utilidades.md) |
| Entradas | Cámara, capturadora y fuentes de video externas en vivo | [`../2026-09-17-fuentes-video-externas/ANALISIS-Y-PLAN.md`](../2026-09-17-fuentes-video-externas/ANALISIS-Y-PLAN.md) |
| Overlays | Placas guardadas que se superponen a lo proyectado | [`overlays.md`](overlays.md) |

---

## Decisiones cerradas con el usuario (2026-09-17)

| Tema | Decisión |
|---|---|
| Alcance de Utilidades | Cuenta regresiva (a hora fija **y** por duración), reloj y cronómetro |
| Cómo proyecta la cuenta regresiva | **Pantalla completa**: es un contenido más, tapa lo que había. El fondo es parte de la utilidad |
| Alcance de Overlays | **Placas guardadas y reutilizables**, en la base de datos: se crean una vez y quedan para el próximo culto |
| Overlay + NEGRO/LOGO | **Se tapa con todo lo demás.** NEGRO es negro, sin excepciones que el operador tenga que recordar |
| Orden de las sub-pestañas de Media | El de `ASSET_KINDS` (video, imagen, audio, PPT), el mismo de settings y validadores |
| Búsqueda de Media | Filtra sólo la vista abierta, en memoria |
| Orden de Media | Se guarda por pestaña en `settings["library.sort"]` |

---

## Lo que ya está entregado

Commit `c8a47c0`, verificado con `typecheck` + `lint` + 113 tests + `build`:

- `ResourcePanel` pasa a tres pestañas; `media-tabs.tsx` y `functions-tabs.tsx` sostienen el
  segundo nivel. Los cuatro `MediaBrowser` no se tocaron.
- `Tabs` gana la variante `segment` para la fila de segundo nivel.
- `Menu` (`components/ui/menu.tsx`): botón de ícono que abre una lista corta. El foco **entra**
  a la lista — cada opción es un `<button>` real — que es lo que mantiene los atajos globales
  fuera del widget: `use-global-shortcuts` suprime Enter/Espacio/flechas para un `<button>`
  enfocado, así que elegir un orden nunca puede además mandar el preview al proyector.
- `floating-menu.ts`: la geometría del portal, que antes vivía dentro de `Select`.
- `MediaFilterBar`: orden + búsqueda por nombre, debajo de la barra de carpetas.
- `lib/media-view.ts`: las reglas de orden y filtro, puras y con diez tests.

---

## Reglas comunes a las tres funciones

Valen para las tres y no se renegocian por pestaña.

1. **`ProjectionOutput` sigue siendo la única verdad de lo proyectado.** Cada función nueva es
   una variante más del `switch` exhaustivo de `selectOutput`, o un campo más del output — no
   un canal paralelo. Un tipo nuevo sin manejar es un error de compilación.
2. **La ventana de proyección no decide nada.** Puede *formatear* (un reloj que se dibuja a sí
   mismo desde una marca de tiempo absoluta es formato, no dominio), pero nunca elegir qué
   mostrar ni cuándo cambiarlo.
3. **Nada que el proyector tenga que sostener viaja como comando.** Lo que se mantiene es
   estado dentro del output; un comando sólo sirve para lo que pasa una vez. La prueba es el
   remonte: si la ventana de proyección se reconstruye, el estado se replica y el comando se
   pierde. Es la misma lección de `startAtSeconds`
   (`.claude/knowledge/startatseconds-is-a-mount-time-seek-so-a-rebuilt-projector-restarts-everything.md`).
4. **Los monitores usan el mismo `OutputView`.** Todo lo que se agregue al proyector se ve
   igual en LIVE y en PREVIEW, o los monitores le mienten al operador.
5. **Seleccionar nunca proyecta** — con una excepción explícita, abajo.

### La excepción de Overlays, dicha en voz alta

Una placa **no es contenido base**: no reemplaza lo proyectado, lo modifica. Por eso no pasa
por el flujo de dos etapas (preview → `goLive()`), sino que se muestra y se saca con su propio
botón, igual que NEGRO y LOGO, que también actúan al instante. Utilidades y Entradas sí son
contenido base y sí respetan las dos etapas.

### Dos trampas ya identificadas, antes de escribir código

- **`sceneContentKey` serializa el output entero menos `transition`**
  (`components/shared/output-view.tsx`). Cualquier campo nuevo que cambie sin que la escena
  cambie —mostrar una placa, un contador que tickea— hace que `OutputView` crea que es una
  escena nueva y **dispare la transición completa**. La placa tiene que quedar fuera de esa
  clave, y la cuenta regresiva no puede llevar el tiempo restante adentro del output.
- **`projection:show` graba historial** (`main/ipc/handlers/projection.ts`, hoy todo menos
  `black` y `logo`). Un reloj, un cronómetro y una placa no son contenido de culto: hay que
  excluirlos ahí mismo o el historial se llena de ruido.

---

## Orden de implementación

Uno por vez, de menor a mayor riesgo. Ninguno depende del anterior salvo donde se dice.

1. **Utilidades.** Es la única de las tres que no necesita ni tabla nueva ni dependencias
   nativas, y obliga a resolver el patrón «el proyector dibuja el tiempo desde una marca
   absoluta» que Overlays después reutiliza para su animación.
2. **Overlays.** Tabla, repositorio, IPC CRUD y —lo verdaderamente nuevo— componer una capa
   por encima de la escena sin tocar las transiciones de la escena.
3. **Entradas.** El más grande por un orden de magnitud: agente de captura nativo, permisos,
   empaquetado y firma por plataforma. Tiene su propio plan, con su propio *gate* de spike.

Cada uno termina con `npm run typecheck && npm run lint && npm run test` en verde y una
verificación a mano contra el proyector real (no sólo los monitores).

---

## Lo que este plan deja explícitamente afuera

- **Que una utilidad o una placa sea un ítem del orden de culto.** Sería un
  `program_items.kind` nuevo, con migración, borrador y programas guardados detrás. Se puede
  hacer después; ninguno de los dos planes lo asume.
- **Composición libre** (texto sobre video con posición y tamaño arbitrarios). Overlays
  entrega plantillas, no un editor.
- **Que el proyector muestre dos utilidades a la vez**, o una utilidad y una entrada externa.
  Contenido base hay uno.
