# Overlays — placas guardadas sobre lo proyectado

**Fecha:** 2026-09-17
**Estado:** plan; no implementado.
**Depende de:** [`PLAN.md`](PLAN.md) — sus cinco reglas comunes, y la excepción que ahí queda
declarada: una placa **no** pasa por el flujo de dos etapas.

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
