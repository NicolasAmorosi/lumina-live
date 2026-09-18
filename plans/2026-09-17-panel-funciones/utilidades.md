# Utilidades — escenas de tiempo: cuenta atrás, reloj y cronómetro

**Fecha:** 2026-09-17 (decisiones ampliadas el 2026-09-17, segunda tanda)
**Estado:** plan cerrado. **F1 entregada y verificada** contra el proyector real (2026-09-18); F2 y F3 pendientes.
**Depende de:** [`PLAN.md`](PLAN.md) — sus cinco reglas comunes valen acá sin excepción.

## Qué resuelve

Los diez minutos antes de que empiece el culto, con la pantalla mostrando cuánto falta. La hora
para el monitor de púlpito. Y un cronómetro para saber cuánto lleva hablando el predicador.

Las tres son **contenido base a pantalla completa**: van a EN VIVO como una diapositiva o un
video, y tapan lo que había.

| Herramienta | Qué muestra | Para qué |
|---|---|---|
| Cuenta regresiva por duración | Lo que falta de N minutos desde que arrancó | «Volvemos en 15 minutos» |
| Cuenta regresiva a hora fija | Lo que falta hasta las `HH:MM` de hoy | «El culto empieza 10:00» |
| Reloj | La hora actual | Monitor de púlpito |
| Cronómetro | Lo transcurrido desde que arrancó | Medir una predicación |

Y, lo que cambió respecto de la primera versión de este plan: cada una de esas cuatro cosas es
una **escena guardada y editable**, no un puñado de parámetros sueltos. El operador crea «Cuenta
10 min» una vez —con su fondo, su tipografía, su color y su mensaje— y el domingo siguiente la
elige de una lista.

---

## Decisiones cerradas con el usuario (2026-09-17, segunda tanda)

| Tema | Decisión |
|---|---|
| Fondo de una escena | **Color sólido, degradado o imagen de la biblioteca** (`media_assets`, servida por `worship://`). El video de fondo queda fuera: metería un segundo `<video>` en el proyector junto al `videoUnderlay`, que es el patrón que ya produjo `PIPELINE_ERROR_DECODE` |
| Tipografía | **Noto Sans + cualquier fuente instalada en el sistema** (`queryLocalFonts()`), más **color y tamaño** |
| ¿Es un ítem del orden de culto? | **Sí.** `program_items.kind = 'utility'`, con migración, borrador y programas guardados detrás |
| Al llegar a cero | **Overrun** (sigue en negativo), **cambio de texto** al terminar y **cambio de color** al acercarse a cero (los *color triggers* de ProPresenter). Los tres, opcionales por escena |
| Temporizadores simultáneos | **Uno**, y **sigue corriendo aunque proyectes otra cosa**: el reloj vive en el control, no en la escena proyectada |
| Visible sin proyectar | **Sí**: un transporte fijo en la pestaña Utilidades, con el número corriendo y arrancar/pausar/reiniciar |
| Dónde se edita | **Modal propio «Escenas»**, abierto desde la pestaña Funciones. Mismo lenguaje visual que Ajustes, con vista previa 16:9 arriba renderizada con el **mismo `OutputView`** que el proyector |
| ¿Modo esquina? | **No todavía.** Pantalla completa ahora; «encima de lo proyectado» llega con Overlays y reusa esta misma maquinaria de tiempo. El texto de la pestaña, que hoy promete «solas o encima de lo que ya está en pantalla», se corrige |

Decisión derivada, no preguntada: **al llegar a cero sin overrun la escena se queda en `00:00`**
y el transporte del control lo marca como terminado. El proyector nunca decide un cambio de
escena por su cuenta — eso es la regla 2 de `PLAN.md`.

---

## La arquitectura, en tres niveles

Esta es la parte que decide si mañana hay que reescribir algo. Son **tres modelos distintos**, y
confundirlos es el error que este plan evita.

### 1. `TimerClock` — lo único que el proyector entiende

El proyector no sabe qué es «una cuenta regresiva a hora fija». Sabe **restar contra un instante**
o **sumar desde un instante**:

```ts
// src/shared/types/timer.ts
export type TimerClock =
  | { mode: "countdown"; state: "running"; endsAtMs: number }
  | { mode: "countdown"; state: "held"; remainingMs: number }
  | { mode: "clock" }
  | { mode: "stopwatch"; state: "running"; startedAtMs: number }
  | { mode: "stopwatch"; state: "held"; elapsedMs: number };
```

**El proyector dibuja el tiempo desde una marca absoluta; nadie manda ticks.** Resta contra su
propio `Date.now()` una vez por segundo. Es formato, no dominio: no hay ninguna decisión ahí
adentro, y las dos ventanas corren en la misma máquina con el mismo reloj.

Dos cosas que este tipo resuelve de un saque:

- **`"held"` cubre «pausado» y «todavía no arrancó» con un solo estado.** El proyector dibuja lo
  mismo en los dos casos; que uno sea pausa y el otro sea reposo sólo le importa al control, para
  saber si el botón dice ARRANCAR o REANUDAR.
- **«Cuenta a hora fija» y «cuenta por duración» colapsan en la misma variante.** El control
  resuelve «hoy a las 10:00» a un `endsAtMs` y el proyector ni se entera. Cuatro herramientas de
  producto, tres relojes de render.

Las dos alternativas se descartan por lo que ya está escrito en `CLAUDE.md`:

- **Mandar un tick por segundo por IPC** son sesenta pushes por minuto durante un culto entero,
  cada uno recalculando `selectOutput`, `sceneContentKey` y el historial. Y si el push se atrasa,
  el número se congela en pantalla.
- **Mandar `secondsRemaining`** es exactamente el error de `startAtSeconds`: un valor correcto al
  montar que queda viejo apenas la ventana se reconstruye
  ([`startatseconds-is-a-mount-time-seek…`](../../.claude/knowledge/startatseconds-is-a-mount-time-seek-so-a-rebuilt-projector-restarts-everything.md)).

**Corolario que hace viable todo esto:** mientras la cuenta corre, el `ProjectionOutput` **no
cambia** (la marca es fija). Ni un push, ni un recálculo, ni una re-animación de escena.

#### Pausar y reanudar son estado, no comandos

```ts
hold({ state: "running", endsAtMs }, now) → { state: "held", remainingMs: endsAtMs - now }
resume({ state: "held", remainingMs }, now) → { state: "running", endsAtMs: now + remainingMs }
```

Funciones puras, en `src/shared/timer.ts`, con sus tests — igual que `freezeLivePositions`.

### 2. `TimerConfig` — lo que el operador configura

Vive en la escena guardada, nunca viaja tal cual al proyector:

```ts
export type TimerTool = "countdown" | "countdown-to-time" | "clock" | "stopwatch";

/** Lo que el proyector aplica al número: es formato, así que viaja entero
 *  dentro del output y se separa del resto de la config, que no. */
export type TimerFormat = {
  hour12: boolean;
  showSeconds: boolean;
  /** Oculta el grupo de horas mientras el valor no llega a una hora — "09:58"
   *  se lee mejor que "00:09:58" en una pantalla grande. */
  hideZeroHours: boolean;
  /** Sigue contando en negativo pasado el cero. */
  overrun: boolean;
};

export type TimerConfig = {
  /** "countdown": milisegundos. */
  durationMs: number;
  /** "countdown-to-time": minutos desde medianoche (no un string "10:00": un
   *  número no tiene formato y no hay que parsearlo dos veces). */
  targetMinuteOfDay: number;
  /** Reemplaza `message` una vez pasado el cero. */
  endMessage: string | null;
  format: TimerFormat;
};
```

`tool` vive en la escena (`UtilityScene`), no en la config: es el discriminante que la lista
necesita sin parsear el JSON, y en F2 es una columna.

### 3. `SceneStyle` — la apariencia, **compartida y reutilizable**

Acá está la apuesta de diseño: la apariencia **no es del timer**. Es de cualquier escena que la
app genere en vez de leer de un archivo. La misma estructura va a servir para:

- las placas de **Overlays** (fase 2 del área),
- los **ajustes de proyección de la Biblia y el texto**, que hoy están hardcodeados en
  `output-view.tsx` y figuran como deuda en `docs/knowledge/07-roadmap-and-debt.md`.

```ts
// src/shared/types/scene-style.ts
export type SceneBackground =
  | { kind: "solid"; color: string }
  | { kind: "gradient"; from: string; to: string; direction: GradientDirection }
  | { kind: "image"; assetId: number; fit: "cover" | "contain" };

export type SceneTextStyle = {
  /** Porcentaje del ANCHO de la salida (`cqw`), nunca px: el proyector 4K y el
   *  monitor de 240px tienen que leerse igual. Es la misma regla que ya cumple
   *  el versículo bíblico. */
  sizeCqw: number;
  color: string;
  /** Sombra para que el texto se lea sobre una imagen de fondo. */
  shadow: boolean;
};

export type SceneStyle = {
  /** Se guarda en la fila. Un cambio de forma es un branch en el normalizador,
   *  no una migración de tabla. */
  version: 1;
  background: SceneBackground;
  /** `null` = la Noto Sans de la app. Cualquier otro valor es el nombre de una
   *  familia instalada en el sistema. */
  fontFamily: string | null;
  fontWeight: 300 | 400 | 600 | 700 | 900;
  verticalAlign: "top" | "middle" | "bottom";
  /** El número grande. */
  value: SceneTextStyle;
  /** Las dos líneas de texto, arriba y abajo del número. */
  title: SceneTextStyle;
  message: SceneTextStyle;
  /** Los *color triggers*: el número cambia de color al acercarse a cero.
   *  `null` = nunca cambia. */
  triggers: { warningAtMs: number; warningColor: string; endColor: string } | null;
};
```

`title`/`message` acá son **sólo estilo**. Los strings viven en la escena
(`UtilityScene.title` / `.message`) porque una placa de Overlays va a tener sus propios campos de
texto con este mismo estilo.

### Por qué el overrun, el texto de fin y el color los decide el PROYECTOR

Parece violar la regla 2 («la ventana de proyección no decide nada») y no la viola. Los tres son
**función pura de la misma marca que el proyector ya está renderizando**:

- si el control tuviera que cambiar el color al llegar al último minuto, necesitaría su propio
  reloj y un push en ese instante — que es exactamente el «mandar ticks» que este diseño
  descarta;
- y ese push cambiaría el `ProjectionOutput`, así que **dispararía la transición de escena
  completa** justo cuando falta un minuto para empezar el culto.

La frontera real es: **la escena no cambia; cambia cómo se dibuja un número dentro de ella.** El
proyector recibe los umbrales y los colores como datos y los aplica. El control, que necesita
saber lo mismo para su transporte, lo deriva de la misma marca con su propio intervalo — sin
IPC de por medio.

---

## Contratos a tocar, archivo por archivo

### `src/shared/`

- `types/timer.ts` — `TimerClock`, `TimerTool`, `TimerConfig`, `TimerFormat`.
- `types/scene-style.ts` — `SceneBackground`, `SceneTextStyle`, `SceneStyle`, `DEFAULT_SCENE_STYLE`.
- `types/utility.ts` — `UtilityScene` (la fila), `UtilitySceneUpsert`, `UtilitySceneUsage`.
- `timer.ts` — las funciones puras: `hold`, `resume`, `resolveTargetMs`, `timerValueMs`,
  `formatTimerValue`, `pickValueColor`, `parseDuration`, `formatDuration`. **Cero dependencias**,
  usadas por main, por el control y por el proyector.
- `scene-validators.ts` — un predicado por campo, al estilo de `SETTINGS_VALIDATORS`, más
  `normalizeSceneStyle()`. `Record<keyof SceneStyle, …>` hace que un campo nuevo sin validador sea
  error de compilación.
- `types/projection.ts` — una variante más de `ProjectionOutputKind`:
  ```ts
  | { kind: "timer"; clock: TimerClock; format: TimerFormat; style: SceneStyle;
      title: string | null; message: string | null; endMessage: string | null;
      backgroundUrl: string | null }
  ```
  y una más de `BaseContent`:
  ```ts
  | { kind: "utility"; sceneId: number; scene: ResolvedUtilityScene; clock: TimerClock }
  ```
  Agregarla rompe la compilación de `selectOutput` hasta que se maneje, que es el punto.

  **La escena viaja RESUELTA dentro de `base`**, no como un id que `selectOutput` va a buscar a
  otro store. Es la misma razón que `videoUnderlay` lleva la url y no el `assetId`: `selectOutput`
  es función pura de `ProjectionStoreState` y su memo compara esa tupla por referencia
  (`outputInputs`). Un `getState()` de otro store ahí adentro rompería las dos cosas.

### `src/main/`

- `db/schema.ts` — tabla `utility_scenes`: `id`, `name`, `tool` (columna, no JSON: es el
  discriminante y la lista lo necesita sin parsear), `config_json`, `style_json`, `title`,
  `message`, `sort_order`, `created_at`, `updated_at`.
- `db/repositories/utility.repo.ts` — CRUD + `reorder` + `findUsages`, calcado de
  `programs.repo.ts` (incluido el `topSortOrder()` negativo y el `reorder` con `json_each`).
  **Parseo defensivo al leer**: un `config_json` corrupto no puede tirar abajo el arranque, cae a
  los defaults campo por campo (la misma disciplina de `DraftRepo.load` y del seed de la Biblia).
- `ipc/handlers/utility.ts` — `utility:list|create|update|delete|duplicate|reorder|usages`, una
  línea por canal en el contrato. El preload no se toca.
- `ipc/handlers/projection.ts` — excluir `kind === "timer"` del `record()` del historial, junto
  con `black` y `logo`. Un reloj no es contenido de culto.
- `drizzle/0010_utility_scenes.sql` (generada) y `drizzle/0011_program_items_utility.sql`
  (**a mano**, ver las trampas).

### `src/renderer/src/`

- `stores/utility.store.ts` — las escenas (espejo de la DB) y **el único temporizador corriendo**:
  `{ sceneId, clock }`. Es el único store que sabe de esto.
- `stores/projection.store.ts` — el `case "utility"` de `selectOutput`, que traduce sin más lógica
  que copiar y resolver la url del fondo con `assetUrl()`; y `setTimerClock()`, que parchea `base`
  en el lugar **sin** `beginScene()` — pausar no es una escena nueva.
- `stores/preview.store.ts` — `PreviewTarget` gana `{ kind: "utility"; sceneId: number }`.
- `lib/hooks/use-preview.ts` — la rama `utility` de `usePreviewContent`/`usePreviewOutput`, con el
  mismo reloj que el transporte, para que el monitor PREVIEW muestre la cuenta corriendo antes de
  mandarla.
- `lib/actions/utility.ts` — `previewUtilityScene`, `startTimer`, `holdTimer`, `resetTimer`,
  `applySceneEdit` (si la escena editada es la que está en vivo, parchea `base.scene`; si no, no
  toca el proyector).
- `components/shared/output-view.tsx` — `TimerScene` dentro de `OutputScene` (ver trampas), y el
  `backgroundUrl` sumado al cálculo de `sceneUrl` para que un fondo roto se reporte como
  cualquier otra imagen.
- `components/pages/functions/` — feature nueva: `utilities-panel.tsx` (lista de escenas +
  transporte), `timer-transport.tsx`, `ScenesModal.tsx`, `scene-form/*`.
- `components/pages/resources/functions-tabs.tsx` — monta `UtilitiesPanel` en lugar del
  placeholder, y se corrige el texto que promete el modo «encima».
- `components/ui/` — `ColorField` (muestras de la paleta oficial + hex propio) y la promoción de
  `SettingsGroup`/`SettingsRow` a `FieldGroup`/`FieldRow`: dos features las usan, así que por la
  regla de reutilización suben de `pages/settings/` a `ui/`.

### Lo que NO se toca

`src/preload/` (el puente es genérico), `projection-state.ts` (el snapshot ya replica lo que
haya), `deck-autoplay.ts`, `worship-protocol.ts` (una imagen de fondo es un `asset/<id>` como
cualquier otro).

---

## Las trampas, identificadas antes de escribir código

1. **`sceneContentKey` serializa el output entero menos `transition`.** Mientras la cuenta corre
   el output no cambia, así que no hay problema *por el tick*. Sí lo hay al pausar, al reanudar y
   al editar la escena en vivo: los tres cambian el output sin ser una escena nueva. Están
   cubiertos porque ninguno llama a `beginScene()`, y el primer branch del efecto de `OutputView`
   corta por `sameEpoch` antes de mirar el contenido. **Regla: nada que toque `base.clock` o
   `base.scene` puede llamar a `beginScene()`.**

2. **Una ventana de Electron ocluida no tiene ciclo de render y Chromium le estrangula los
   timers.** Ya está medido en este repo: `visibilityState: "hidden"`, cero frames
   ([`occluded-electron-window-has-no-rendering-lifecycle`](../../.claude/knowledge/occluded-electron-window-has-no-rendering-lifecycle.md)).
   Y a los 5 minutos oculta, Chromium baja los `setTimeout` a **uno por minuto**. Con un solo
   monitor la ventana de proyección es una ventana común tapada por el control: el caso se da.
   Por eso el tick **no acumula**: cada disparo vuelve a leer `Date.now()` y re-arma el próximo
   alineado al segundo. Un tick estrangulado muestra un número viejo mientras nadie lo está
   mirando, y el primer frame después de volver a ser visible ya es correcto — más un listener de
   `visibilitychange` que repinta al instante. No se toca `backgroundThrottling`: apagarlo tiene
   un bug conocido de ventana en blanco (electron#42378) y este diseño no lo necesita.

3. **Alinear el intervalo al segundo.** `setTimeout(tick, 1000 - (Date.now() % 1000))`, re-armado
   en cada tick. Sin eso el número salta de a dos de vez en cuando, que en una pantalla de tres
   metros se ve.

4. **`font-variant-numeric: tabular-nums`.** Sin eso los dígitos tienen anchos distintos y el
   número entero se mueve en cada segundo.

5. **El `CHECK` de `program_items` es invisible para Drizzle.** Ya hay precedente exacto:
   `drizzle/0009_drop_text_program_items.sql` reconstruye la tabla a mano. Agregar
   `kind = 'utility'` es lo mismo — tabla nueva, copia, drop, rename, índice — más
   `utility_scene_id` con FK `ON DELETE restrict` y el `CHECK` ampliado a tres ramas
   ([`sqlite-table-rename-must-alter-not-recreate`](../../.claude/knowledge/sqlite-table-rename-must-alter-not-recreate.md)).

6. **Un FK `restrict` rechaza el borrado como `SQLITE_CONSTRAINT_TRIGGER`, y un `void asyncCall()`
   se lo come.** Borrar una escena usada por un programa guardado tiene que seguir el camino que
   ya existe para los assets: `utility:usages` primero, confirmación que dice en qué programas
   está, y `force: true` que borra los ítems en la misma transacción
   ([`fk-restrict-delete-is-silently-swallowed`](../../.claude/knowledge/fk-restrict-delete-is-silently-swallowed.md)).

7. **El borrador tiene que filtrar escenas muertas.** `DraftRepo.withLiveAssetsOnly` hoy sólo
   mira `media_assets`; un ítem `utility` cuya escena ya no existe volvería como una fila que no
   se puede previsualizar ni explicar. Se generaliza a las dos referencias.

8. **Una fuente del sistema puede no estar la próxima vez.** Se guarda el nombre de la familia y
   se renderiza con la cadena `"<familia>", var(--font-sans)`, así que la ausencia degrada a Noto
   Sans sola. El editor compara contra `queryLocalFonts()` al abrir y avisa si la familia guardada
   ya no está, en vez de mostrar una vista previa que miente. El nombre se valida al guardar
   (sin comillas, sin `;`, sin llaves): termina en un `style` inline.

9. **El historial.** `projection:show` graba todo menos `black` y `logo`. Sin excluir `timer`, el
   historial se llena de relojes.

---

## Fases

Una por vez, cada una terminando con `npm run typecheck && npm run lint && npm run test` en verde
y una verificación a mano **contra el proyector real**, no sólo los monitores.

### F1 — El contrato y el proyector, con las cuatro herramientas

Tipos, `selectOutput`, `TimerScene` en `OutputScene`, `utility.store`, el panel con la lista y el
transporte, preview y EN VIVO por el camino normal, exclusión del historial. **Sin base de datos
y sin editor**: la lista se llena con escenas por defecto (`DEFAULT_UTILITY_SCENES`) que en F2 se
vuelven las filas sembradas. El shape del store es el mismo en las dos fases, así que no hay nada
que reescribir.

**Gate:** cerrar y reabrir la ventana de proyección a mitad de una cuenta tiene que continuarla en
el número correcto, no reiniciarla. Si eso falla, el modelo está mal y no se sigue.

**Resultado (2026-09-18), medido sobre la app corriendo, no sobre los tests:** proyector en 09:34 →
09:31 tres segundos después → **09:29 tras destruir y reconstruir la ventana de proyección** →
negro total bajo NEGRO → 09:25 al destapar, con los dos monitores del control mostrando el mismo
09:25 que el proyector. Las cuatro herramientas verificadas: la cuenta a hora fija resolvió
9:40:46 a las 00:19, el reloj mostró la hora, y el cronómetro contó 00:02 y se congeló ahí al
pausarlo.

### F2 — Persistencia y el editor

Tabla, repo, validadores, IPC, el modal «Escenas» con la vista previa en vivo, `ColorField`, la
promoción de `FieldGroup`/`FieldRow`, fondo sólido/degradado/imagen, selector de fuente, los
*color triggers*, el texto de fin y el overrun.

**Gate:** editar la escena que está EN VIVO actualiza el proyector **sin** disparar la transición
de escena ni reiniciar la cuenta.

### F3 — Ítem del orden de culto

La migración a mano, `PROGRAM_ITEM_KINDS`, los DTO, el filtro del borrador, la fila del programa,
la rama de preview, el guard de borrado con `usages`.

**Gate:** guardar un programa con una escena, cerrar la app, abrirla, cargar el programa y
mandarla EN VIVO. Y borrar la escena que un programa guardado usa avisa en qué programa está.

### Fuera de alcance, explícito

- **Video de fondo** (ver decisiones).
- **Modo esquina / encima de lo proyectado**: llega con Overlays.
- **Varios temporizadores a la vez.**
- **Sonido al llegar a cero.**
- **Composición libre** (mover y redimensionar el texto a gusto): la escena tiene tres roles de
  texto con tamaño, color y alineación vertical, no un canvas.

---

## Criterios de aceptación

- Una cuenta regresiva a las 10:00 muestra el mismo número en el proyector y en los dos monitores,
  y llega a `00:00` dentro del segundo.
- NEGRO la tapa y la sigue corriendo debajo; al destapar, el número es el que corresponde al
  momento, no el que había al tapar.
- Cerrar y reabrir la ventana de proyección no altera la cuenta.
- Pausar, esperar treinta segundos y reanudar continúa treinta segundos después, no treinta
  segundos antes.
- Arrancar una cuenta, mandar un video EN VIVO y volver a la cuenta muestra el número que
  corresponde, no el que tenía al salir.
- Con overrun apagado la cuenta se queda en `00:00`; con overrun prendido muestra `-01:23`.
- El cronómetro se puede leer en la pestaña Utilidades sin estar proyectado.
- Mandar cualquier otra cosa EN VIVO reemplaza la escena; volver a ella la muestra tal como quedó.
- El historial de proyección no tiene una fila por reloj.
- Una escena creada en un culto sigue estando la semana siguiente, sin volver a configurarla (F2).
- Un programa guardado con una escena la recupera al abrirlo (F3).
