# Utilidades — cuenta regresiva, reloj y cronómetro

**Fecha:** 2026-09-17
**Estado:** plan; no implementado.
**Depende de:** [`PLAN.md`](PLAN.md) — sus cinco reglas comunes valen acá sin excepción.

## Qué resuelve

Los diez minutos antes de que empiece el culto, con la pantalla mostrando cuánto falta. Y dos
cosas más que caen en la misma familia: la hora, y un cronómetro que cuenta hacia arriba para
saber cuánto lleva hablando el predicador.

Las tres son **contenido base a pantalla completa**: van a EN VIVO como una diapositiva o un
video, y tapan lo que había. Decisión cerrada con el usuario el 2026-09-17.

| Herramienta | Qué muestra | Para qué |
|---|---|---|
| Cuenta regresiva a hora fija | Lo que falta hasta las `HH:MM` de hoy | «El culto empieza 10:00» |
| Cuenta regresiva por duración | Lo que falta de N minutos desde que arrancó | «Volvemos en 15 minutos» |
| Reloj | La hora actual | Monitor de púlpito |
| Cronómetro | Lo transcurrido desde que arrancó | Medir una predicación |

---

## La decisión de diseño que sostiene todo lo demás

**El proyector dibuja el tiempo desde una marca absoluta; nadie manda ticks.**

El output lleva un instante (`endsAtMs` o `startedAtMs`, epoch en milisegundos) y la ventana de
proyección resta contra su propio reloj una vez por segundo. Es formato, no dominio: no hay
ninguna decisión ahí adentro, y las dos ventanas corren en la misma máquina, con el mismo
reloj, así que un epoch absoluto no es ambiguo.

Las dos alternativas se descartan por lo mismo que ya está escrito en `CLAUDE.md`:

- **Mandar un tick por segundo por IPC** es sesenta pushes por minuto durante un culto entero,
  cada uno recalculando `selectOutput`, `sceneContentKey` y el historial. Y si el push se
  atrasa, el número se congela en pantalla.
- **Mandar `secondsRemaining`** es exactamente el error de `startAtSeconds`: un valor correcto
  en el momento del montaje que queda viejo apenas la ventana se reconstruye. Reabrir el
  proyector a mitad de la cuenta la reiniciaría en el número que tenía al empezar.

Corolario para `sceneContentKey`: mientras la cuenta corre, el output **no cambia** (la marca
es fija), así que la escena no se re-anima sola. Eso no es un detalle: es lo que hace viable
esta variante.

### Pausar

Pausar una cuenta regresiva no puede ser un comando, por la regla 3 del plan general. Se
modela como estado, con una sola cosa autoritativa por vez:

```ts
// src/shared/types/projection.ts
export type TimerScene =
  | { mode: "countdown"; endsAtMs: number; paused: false }
  | { mode: "countdown"; remainingMs: number; paused: true }
  | { mode: "clock" }
  | { mode: "stopwatch"; startedAtMs: number; paused: false }
  | { mode: "stopwatch"; elapsedMs: number; paused: true };
```

Al pausar, el control congela el número (`remainingMs = endsAtMs - Date.now()`) y lo manda;
al reanudar, lo vuelve a convertir en una marca (`endsAtMs = Date.now() + remainingMs`). El
proyector nunca hace esa cuenta: recibe una u otra forma y dibuja.

---

## Contratos a tocar

### `src/shared/types/projection.ts`

- `TimerScene`, arriba, más la apariencia que el proyector necesita para pintarla:

  ```ts
  export type TimerAppearance = {
    /** Línea opcional debajo del número: "El culto comienza en…". */
    message: string | null;
    /** Color de fondo, del tema o elegido. La imagen de fondo queda para una
     *  fase posterior: sale de `media_assets` y arrastra el protocolo entero. */
    background: string;
  };
  ```

- Una variante más de `ProjectionOutputKind`:
  `{ kind: "timer"; timer: TimerScene; appearance: TimerAppearance }`.
- Una variante más de `BaseContent`: `{ kind: "timer"; utility: TimerScene; appearance: … }`.
  Agregarla rompe la compilación de `selectOutput` hasta que se maneje, que es el punto.

### `src/renderer/src/stores/`

- Store nuevo `utility.store.ts`: qué herramienta está elegida, sus parámetros (hora objetivo,
  duración, mensaje, fondo) y su estado corriendo/pausado. Es el único que sabe de esto.
- `projection.store.ts`: el `case "timer"` de `selectOutput`, que traduce el `BaseContent` a
  `ProjectionOutputKind` sin más lógica que copiar.
- `preview.store.ts`: `PreviewTarget` gana `{ kind: "utility" }`. Una utilidad se previsualiza
  como todo lo demás — el monitor PREVIEW muestra el mismo `OutputView` con el mismo contador
  corriendo, que es lo que permite ajustar el mensaje antes de mandarlo.

### `src/renderer/src/components/shared/output-view.tsx`

Un `TimerScene` dentro de `OutputScene`: un `useEffect` con `setInterval` de 1 s que sólo
llama a `setState` con la hora actual, y el número formateado en `cqw` como el versículo
bíblico. Pausado, el intervalo no corre.

Ojo con el intervalo: hay que alinearlo al segundo (`1000 - (Date.now() % 1000)` la primera
vez) o el número salta de a dos a veces, que en una pantalla grande se ve.

### `src/renderer/src/components/pages/resources/`

`functions-tabs.tsx` deja de mostrar el placeholder de Utilidades y monta `utilities-panel.tsx`:
la lista de las cuatro herramientas arriba, los parámetros de la elegida en el medio, y el pie
con «Agregar al programa» deshabilitado (ver *fuera de alcance*) y EN VIVO por el camino
normal — `previewUtility()` + `goLive()`, nunca un atajo al `projection.store`.

### `src/main/ipc/handlers/projection.ts`

Excluir `kind === "timer"` del `record()` del historial, junto con `black` y `logo`. Un reloj
no es contenido de culto.

### Persistencia

**Sin tabla nueva en v1.** Lo último usado (duración, hora objetivo, mensaje, fondo) va a una
clave de `settings` con su validador, como el resto. Una tabla de «utilidades guardadas» sólo
se justifica cuando haya más de un preset por herramienta, y hoy no lo hay: la iglesia usa la
misma cuenta de diez minutos todos los domingos.

---

## Fases

### Fase 1 — La cuenta regresiva, entera

1. `TimerScene` + las dos variantes de tipo; `selectOutput` deja de compilar y se completa.
2. `TimerScene` en `OutputScene`, con el intervalo alineado al segundo.
3. `utility.store` + el panel, sólo con la cuenta regresiva en sus dos formas.
4. Preview, EN VIVO, NEGRO/LOGO y reapertura de la ventana de proyección verificados **contra
   el proyector real**, no sólo los monitores.
5. Tests: la conversión pausa↔reanuda (`endsAtMs` ↔ `remainingMs`) es pura y va a
   `tests/renderer/`, igual que `live-positions`.

**Gate:** reabrir la ventana de proyección a mitad de una cuenta tiene que continuarla en el
número correcto, no reiniciarla. Si eso falla, el modelo está mal y no se sigue.

### Fase 2 — Reloj y cronómetro

Mismo contrato, dos modos más. El cronómetro comparte el pausar/reanudar de la Fase 1 con el
signo cambiado; el reloj no tiene estado en absoluto.

### Fase 3 — Apariencia

Mensaje, tamaño y color de fondo configurables, con lo último usado en `settings`. La imagen
de fondo queda afuera hasta que se decida si sale de `media_assets` (y entonces necesita
`worship://`, vista previa y el caso «el archivo ya no está»).

---

## Criterios de aceptación

- Una cuenta regresiva a las 10:00 muestra el mismo número en el proyector y en los monitores,
  y llega a 00:00 dentro del segundo.
- NEGRO la tapa y la sigue corriendo debajo; al destapar, el número es el que corresponde al
  momento, no el que había al tapar.
- Cerrar y reabrir la ventana de proyección no altera la cuenta.
- Pausar, esperar treinta segundos y reanudar continúa treinta segundos después, no treinta
  segundos antes.
- Mandar cualquier otra cosa EN VIVO reemplaza la utilidad; volver a ella la muestra tal como
  quedó.
- El historial de proyección no tiene una fila por reloj.

---

## Decisiones pendientes (para la próxima tanda de preguntas)

1. **Qué pasa cuando llega a cero.** Queda en `00:00`; se va a negro; salta al primer ítem del
   programa; o muestra un mensaje distinto. Recomendación: queda en `00:00` y el control avisa
   — el proyector nunca decide un cambio de escena por su cuenta.
2. **Si la cuenta puede seguir en negativo** (`-01:23`), que es lo que hacen las consolas de
   TV para avisar cuánto se pasaron.
3. **Si el reloj y el cronómetro necesitan formato de 12 h**, o siempre 24 h.
4. **Si el cronómetro tiene que verse en el control aunque no esté proyectado** — medir una
   predicación sin ocupar la pantalla es un uso razonable y cambia dónde vive el estado.
