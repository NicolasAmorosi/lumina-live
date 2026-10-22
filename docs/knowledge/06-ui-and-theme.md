# 06 — UI y sistema de diseño

## Origen: calcado de `libretto-villaaurora`

La arquitectura de `src/renderer/src/components/` (no la paleta) es una copia deliberada de
`libretto-villaaurora/apps/web/src/components`: `ui/` (primitivas), `shared/` (composiciones
cross-feature), `pages/` (una carpeta por feature). Ver la sección "Reutilización de componentes"
en `CLAUDE.md` — es la regla que no se negocia en este repo.

Piezas copiadas casi literalmente porque resuelven un problema no obvio:

- `lib/utils.ts` → `cn()` con `extendTailwindMerge` extendiendo el grupo `shadow` con
  `surface`/`raised`/`overlay` — sin esto, `tailwind-merge` no sabe que `shadow-surface` y
  `shadow-none` compiten entre sí.
- `components/ui/button.tsx` → el patrón de referencia para toda primitiva nueva.
- `components/shared/modal/` → stack global + portal, para que solo el modal superior pinte el
  backdrop cuando hay más de uno abierto.

## Identidad: Lumina Live

Desde el 2026-10-22 el producto se llama **Lumina Live** y tiene identidad propia, que reemplazó a
la paleta adventista (ALPS/Denim) de las versiones anteriores. La fuente es la hoja «Identidad App
Lumina Live» (PDF de Illustrator, dos páginas: paleta por modo, y logo + wordmark). Tres cosas de esa
hoja que no se ven a simple vista y se sacaron leyendo el PDF por dentro:

- El **Secundario del modo claro** está rotulado `#2f557f` (igual que el Primario) pero dibujado
  `#213c59`. Vale el dibujado.
- La tipografía de la hoja es **Noto Sans ExtraCondensed** (ExtraBold en títulos y en el wordmark,
  SemiBold en rótulos). Es la misma familia que el texto de la app, en otro ancho.
- El logo es vectorial: rectángulo redondeado `#162231` (radio 7,3 %), un resplandor radial
  `#f7931e` al 8 %, y cuatro llamas — `#ffad40` al 31 %, `#ffa92d`, `#e36520`, `#d14600`. «Live»
  va en `#d14600`. Está trazado tal cual en `src/renderer/src/assets/brand/lumina-live-mark.svg`.

### La paleta y sus roles

`src/renderer/src/styles/globals.css` define **dos paletas físicas** (`--wa-*`, en `:root`/
`[data-theme="dark"]` y en `[data-theme="light"]`) mapeadas a **un solo set de tokens
semánticos** vía `@theme inline`. Los componentes solo referencian los semánticos — nunca `--wa-*`
directo — así el toggle de tema no requiere tocar ningún componente.

| Hoja | Claro | Oscuro | Token |
|---|---|---|---|
| Fondo | `#ffffff` | `#162231` | `background`, `surface` (paneles, barra, campos) |
| Cuadro de diálogo | `#f5f6f9` | `#1b2c41` | `card` (diálogos, menús, tooltips, miniaturas) |
| Bordes | `#c8d2dc` | `#2e4155` | `border` |
| Primario | `#2f557f` | `#203651` | `primary` — el botón principal |
| Secundario | `#213c59` | `#8299b2` | `secondary` — el botón secundario |
| Texto primario / secundario | `#182a40` / `#5c7089` | `#eef2f6` / `#9aa9b8` | `foreground` / `muted-foreground` |
| Acento | `#3e8391` | `#3e8391` | `accent` — seleccionado, foco, encendido |
| Indicadores | `#448d21` `#ffa92d` `#e36520` `#dd1f1f` | iguales | `success`, `warning`, `badge-ppt`, `danger` y `on-air` |

Los roles los decidió el dueño de la identidad (2026-10-22): **Primario = botón principal,
Secundario = botón secundario, Acento = selección/foco**, y **en vivo = rojo** (convención de
tally; el naranja del «Live» del logo quedó para la marca y el badge de presentaciones).

Consecuencias que importan al tocar la paleta:

1. **El Primario oscuro está a 1,31:1 del fondo.** Un botón principal sin borde es una etiqueta
   flotando en la nada, así que lleva `border-primary-border` (`#384f69`, Primario → Secundario al
   25 %). En claro ese token vale lo mismo que el relleno y no agrega nada. Es sobrio a propósito
   —la cabina está a oscuras—, y por lo mismo el Secundario (acero claro) resalta más que el
   Primario en oscuro: es la lectura literal de la hoja, aceptada así.
2. **Lo que la hoja no define se MEZCLA, no se inventa.** `muted` y `hover` son Diálogo → Bordes al
   35 % y 65 %; el borde claro más fuerte es Bordes → Texto secundario al 20 %; la fila
   seleccionada (`active`) es Fondo + 26 % de acento en oscuro, que es lo máximo antes de que
   `text-subtle` sobre ella baje de 4,5:1.
3. **La selección es teal en todos lados**: borde de la miniatura elegida, riel de la pestaña
   activa, toggle presionado (relleno), switch, slider, progreso, indicador de arrastre. Las filas
   y pestañas seleccionadas llevan además un filete `ring-accent/40`: el tinte solo, en claro, está
   apenas un tono por debajo del diálogo.
4. **El texto terciario no existe en claro.** La hoja tiene dos grises y `#5c7089` ya está en
   4,57:1 sobre `bg-muted`: un tercer gris más claro falla AA. `text-subtle` vale lo mismo que
   `muted-foreground` en claro; la jerarquía sale del tamaño y el peso.
5. Los badges por tipo de contenido salen de la hoja: presentaciones = naranja, video = ámbar,
   imagen = verde, audio = teal, Biblia = Primario (claro) / Secundario (oscuro). Se pintan como
   tinte al 20 % con `text-foreground` encima.

### Relleno, tinta y AA — la rampa `-ink`

Un token de color tiene **dos roles incompatibles**: como **relleno** (`bg-danger` con blanco
encima) tiene que ser oscuro para que el blanco se lea; como **texto** sobre `bg-card` tiene que
ser claro para leerse él. Por eso hay una segunda familia, `--color-<tono>-ink`, para los cinco tonos
que aparecen como texto o ícono suelto. Cada una es su color de la hoja aclarado (oscuro) u
oscurecido (claro) justo hasta pasar 4,5:1 sobre la peor superficie donde cae:

| Token | Oscuro | Claro |
|---|---|---|
| `danger-ink` | `#eb7979` (rojo + 40 % blanco, 5,09) | `#dd1f1f` tal cual (4,53 sobre `#f5f6f9`) |
| `accent-ink` | `#78a8b2` (teal + 30 %, 5,42) | `#356f7b` (teal − 15 %, 5,24) |
| `success-ink` | `#7caf64` (verde + 30 %, 5,51) | `#3a781c` (verde − 15 %, 5,00) |
| `warning-ink` | `#ffa92d` tal cual (7,39) | `#8c5d19` (ámbar − 45 %, 5,26) |
| `badge-audio-ink` | = `accent-ink` | = `accent-ink` |

(`accent-ink` se llamaba `primary-ink` cuando el azul era a la vez acción y selección.)

El otro sentido también se mide: **un relleno con texto blanco encima tiene que pasar 4,5:1**. El
verde de la hoja da 4,14 y el teal 4,32, así que `success` es `#3f821e` (−8 %) y `accent` es
`#3a7b88` (−6 %) — a la vista son el mismo color. El ámbar nunca lleva blanco (1,92:1): su
`warning-foreground` es el texto oscuro de la hoja (7,59:1). La banda «No hay logo cargado» del
monitor lo violó la primera vez que se aplicó esta paleta, porque escribía `text-white` para
cualquier tono.

Oscuro es el default (`DEFAULT_SETTINGS['ui.theme']` en `shared/types/settings.ts`) — pensado
para operarse en una cabina de proyección a oscuras.

### Forma, foco, elevación y movimiento

- **Píldora** para todo lo que actúa o marca: `Button`, `IconButton` (círculo), `Badge`, `Switch`,
  los segmentos y la barra lateral de `Tabs`. Diálogos `rounded-2xl`; tarjetas, grupos
  (`FieldGroup`), menús y popovers `rounded-xl`; campos, miniaturas y filas `rounded-lg`. Una
  superficie nunca contiene un radio mayor que el suyo.
- **Foco = `outline`** con las utilidades `focus-ring` / `focus-ring-inset` de `globals.css`, nunca
  `ring` + `ring-offset`: Tailwind pinta el hueco del offset con un color explícito (blanco por
  defecto), y en el tema oscuro cada control enfocado tenía un halo blanco de 1 px. El hueco de un
  `outline-offset` es transparente en cualquier superficie. `-inset` es para lo que vive dentro de
  algo que recorta (pestañas, grillas de miniaturas, listas).
- **Un toggle presionado se RELLENA de acento** (`toggled` de `Button`/`IconButton`). Antes era un
  anillo del color del foco: «está encendido» y «tiene el teclado» se veían igual. Los tres estados
  del proyector de la TopBar (LOGO / NEGRO / VIVO) son `outline` y el encendido se llena de teal.
- **Superficies en reposo planas** (`shadow-surface` = nada): la hoja dibuja sus cajas con borde y
  sin sombra. `raised` y `overlay` siguen, en navy y más suaves en el tema claro.
- **Movimiento**: `--ease-enter`/`--ease-exit`; el modal y su velo entran en 150 ms
  (`wa-modal-enter`/`wa-backdrop-enter`), sin animación de salida a propósito — un diálogo que se
  está cerrando no debería seguir tomando foco ni clicks. Todo lo decorativo va por `motion-safe:`
  (el pulso del punto EN VIVO, el del audio vinculado, el skeleton, el spinner). Las transiciones
  del PROYECTOR no: esas son contenido, no interfaz (ver la nota en `globals.css`).
- El velo de un modal es `bg-scrim`: negro al 60 % en oscuro, navy al 40 % en claro.
- **Sin espacio, cede el texto, nunca el ícono** (regla del dueño, 2026-10-22). `Icon` y `Badge`
  son `shrink-0` de base; el texto se trunca en su propio `<span className="truncate">` —
  `Button` (`truncateText()`) y `Tabs` lo hacen solos. Las pestañas de ancho igual (`folder`,
  `segment`) muestran el nombre completo como `title` al pasar el mouse, solo si está cortado.

## Tipografía: Noto Sans y su corte ExtraCondensed

Noto Sans para todo lo que el operador lee; **Noto Sans ExtraCondensed** (`font-stretch-extra-condensed`,
62,5 %) para los títulos — `Title` h1/h2 (las cabeceras PROGRAMA / PREVIEW / EN VIVO y los grupos
de Ajustes), los títulos de modal (`ModalTitle`) y el wordmark. Un corte condensado se lee más chico
que su tamaño, por eso h2 sube a 15 px donde un rótulo de texto tendría 14.

Las dos salen del MISMO archivo variable: `main.tsx` importa
`@fontsource-variable/noto-sans/wdth.css` (ejes `wdth` 62,5–100 % + `wght`), no el import por
defecto del paquete, que trae solo `wght` — con ese, `font-stretch` no hace nada y el navegador
sintetiza un condensado falso. La proyección sigue con el import por defecto: el escenario no usa
el corte condensado. Todo self-hosted, sin Google Fonts: la app queda usable sin internet desde el
primer render.

## La marca dentro de la app

`components/ui/brand.tsx`: `BrandMark` (el SVG del logo, como `<img alt="">` — es un asset, sus
colores son del logo y no del tema, y es el único lugar donde un hex es legítimo) y `Wordmark`
(«Lumina / Live» en ExtraCondensed ExtraBold, interlineado 0,858 como en la hoja, «Live» en
`text-brand-live`). Aparece en dos lugares, por decisión del dueño: el isotipo a la izquierda de la
TopBar y el encabezado de **Ajustes ▸ Acerca de** (logo, nombre, versión, registros). Nunca en el
proyector: con LOGO y sin logo elegido el escenario sigue negro, la congregación ve la marca de la
iglesia y no la del software.

Íconos de la app, generados desde el mismo SVG: `build/icon.icns` (macOS, grilla de Apple: cuerpo
de 824 px con radio ~22 % y la sombra de la plantilla) y `build/icon.png` (Windows/Linux, la forma
de la hoja con 3 % de margen; electron-builder saca el `.ico` de ahí). Se renderizaron con una
ventana offscreen de Electron (evento `paint`, que sí conserva el alfa) e `iconutil`.

## Formularios: `FieldGroup`/`FieldRow`, y `ColorField`

`FieldGroup` + `FieldRow` (`components/ui/field.tsx`) son la forma de CUALQUIER pantalla de
opciones: un título, un recuadro con líneas divisorias y una fila por opción — etiqueta (con
descripción opcional) a la izquierda, su control a la derecha, sin envolver nunca. Nacieron dentro
de Ajustes como `SettingsGroup`/`SettingsRow` y subieron a `ui/` cuando el editor de escenas de
Utilidades fue el segundo consumidor: es literalmente la regla de reutilización de `CLAUDE.md`
disparándose. Se agrega una opción a un grupo existente, o se abre un grupo nuevo; nunca una lista
plana de filas.

`ColorField` es el control de color. Elige de las muestras de la hoja de Lumina Live (neutros,
azules, acento, indicadores y la llama, con los valores EXACTOS de la hoja y no los ajustados a AA
de la interfaz: en el proyector el color es de la marca) o acepta un hex propio, y **solo emite `#rrggbb`** — una sola forma
canónica, porque dos escrituras del mismo color en la base es una comparación que falla sobre un
valor que el operador nunca ve. Abre su popover por portal con `computeMenuPosition`, igual que
`Select` y `Menu`, porque todo panel y todo diálogo de esta app recorta su overflow.

Los hex que aparecen en `color-field.tsx`, en `DEFAULT_SCENE_STYLE` y en `DEFAULT_BIBLE_STYLE`
**no violan** la regla de "nada de colores hardcodeados en un componente" —y desde el
2026-10-22 también salen de la hoja de Lumina Live; una escena guardada antes conserva los suyos—: son valores de
CONTENIDO, guardados en una fila y editables por el operador —la misma categoría que el nombre de
un programa—, y terminan en un `style` inline sobre el escenario del proyector, que no tiene tema.
Un color de la INTERFAZ sigue saliendo siempre de un token semántico.

`Slider` (`components/ui/slider.tsx`) es el rango con su valor al lado. El ancho del número va en
**`ch`** y no en píxeles (`readoutChars`): con `tabular-nums` un `ch` es exactamente un dígito, así
que una caja del largo de la cadena más larga que ese slider puede producir no lleva espacio
muerto — y el espacio muerto adentro del item se suma al `gap` de la fila, que es el bug medido en
[`.claude/knowledge/fixed-width-readout-inflates-flex-gap.md`](../../.claude/knowledge/fixed-width-readout-inflates-flex-gap.md).

### `components/shared/style-fields.tsx` — las perillas de todo lo que se VISTE

`SceneStyle` se diseñó para vestir tres cosas (escenas de tiempo, las placas de Overlays y el
versículo bíblico). Los controles de lo que esas tres comparten —fondo sólido/degradado/imagen,
tipografía, alineación vertical, y las cuatro perillas de un rol de texto— viven acá, no dentro
del editor de escenas donde nacieron. Cada uno es un `FieldRow` pelado: el `FieldGroup` lo pone
quien los usa, así que un editor puede darle al fondo un grupo propio y otro puede intercalarlo
entre sus filas.

Las etiquetas se mudaron con ellos, de `scenes.*` a **`style.*`**. Dos features deletreando «Tipo
de fondo» desde dos entradas del diccionario es exactamente como las dos escrituras empiezan a
diferir.

## El versículo bíblico — `BibleScene` y el ajuste automático

`components/shared/bible-scene.tsx` dibuja la variante `bible` de `ProjectionOutput`, que ahora
viaja **vestida**: lleva su `BibleStyle` y su `backgroundUrl` resueltos adentro, por la misma razón
que los lleva una escena de tiempo — la ventana de proyección no resuelve nada y
`projection-state.ts` reproduce ese valor tal cual en una ventana reconstruida en otra pantalla.

Es hermano de `TimerScene` y deliberadamente **no** una generalización suya: una cuenta regresiva
es una tirada corta de glifos que nunca corta línea y un versículo es un PÁRRAFO. De ahí los
cuatro campos que `SceneStyle` no tiene —`textAlign`, `lineHeight`, `maxWidthCqw` y `autoFit`— y
dos roles de texto nombrados por lo que son (`text`, `reference`) en vez de doblados sobre
`value`/`title`/`message`.

**El ajuste automático se MIDE, no se calcula.** Juan 11:35 son dos palabras y Ester 8:9 son
ochenta: a tamaño fijo, uno se pierde en el medio del cuadro y el otro se va por abajo — y el
monitor de confianza, que renderiza el mismo componente con la misma proporción, lo recorta
igual, así que en la cabina tampoco se ve. `useFittedTextSize` hace una búsqueda binaria de siete
pasos escribiendo el `font-size` directo sobre el elemento (una medición necesita que el navegador
ya haya maquetado; siete `setState` serían siete frames de texto achicándose) y recién commitea la
RESPUESTA al estado. Dos detalles que no son opcionales:

- se mide el **bloque**, no el párrafo: la referencia está en la misma caja acotada y el versículo
  no puede empujarla fuera del escenario;
- se mide contra el **espacio**, no contra el desborde del propio bloque. El bloque está acotado
  por `max-h-full`, así que hasta llegar a ese techo su altura ES la de su contenido, y ahí
  `scrollHeight > clientHeight` ya no pregunta «no entra en el escenario» sino «hay tinta fuera de
  sus line boxes» — que un `line-height` por debajo del content area de la fuente (1,362 em en
  Noto Sans; el slider llega a 0,8) vuelve cierto a CUALQUIER tamaño. Con eso la búsqueda binaria
  no encontraba nunca un tamaño que entrara y devolvía siempre `minSizeCqw`: el versículo se
  achicaba solo y los cuatro sliders de «Versículos» parecían muertos. Se compara contra el
  content box del escenario, con 1 px de tolerancia porque `clientHeight`/`scrollHeight` son
  enteros redondeados de un layout fraccionario. `overflow-hidden` sigue, pero ya sólo como la
  guarda que impide pintar por fuera del cuadro. Diagnóstico y mediciones en
  [`.claude/knowledge/a-content-sized-box-never-fits-itself-so-scrollheight-is-not-a-fit-test.md`](../../.claude/knowledge/a-content-sized-box-never-fits-itself-so-scrollheight-is-not-a-fit-test.md);
- el `ResizeObserver` observa el **escenario**, no el bloque. Observar el bloque es un bucle por
  construcción: el callback cambia el tamaño de letra, que cambia el bloque, que dispara el
  callback.

El bloque guarda además un margen vertical fijo (`EDGE_GUTTER_CQW`, el equivalente vertical de
`maxWidthCqw`): sin él un versículo achicado entra EXACTO en el cuadro, y en un proyector con
overscan eso es la primera y la última línea cortadas al medio.

## Layout de la ventana de control — EasyWorship 2009

`components/pages/layout/AppShell.tsx` es el workspace completo, calcado de EasyWorship 2009:

```
┌ TopBar (grid-cols-3, igual que el main de abajo) ──────────────────────┐
│ ⚙ · [nombre del programa · guardado · 💾 ✚ 📂]│▷ EN VIVO│LOGO·NEGRO·▷EN VIVO│
├───────────────┬──────────────┴────────┬─────────────────────────────────┤
│ PROGRAMA      │                       │  EN VIVO                        │
│ (schedule)    │      DIAPOSITIVAS     │  (+ transporte deck)            │
│───────────────│   del ítem en preview │  (+ tira de diapositivas live)  │
│ RECURSOS      │                       │──────────────────────────────── │
│ Biblia|Vid|   │                       │  VISTA PREVIA                   │
│ Img|Aud|PPT   │                       │                                 │
└───────────────┴───────────────────────┴─────────────────────────────────┘
```

El `TopBar` es un **grid de 3 columnas idéntico al del `<main>`** de abajo (`grid-cols-3`), así
cada grupo de controles queda exactamente arriba de la columna sobre la que actúa, no importa el
ancho de la ventana:

- **Columna 1** (arriba de Programa/Recursos): el isotipo de Lumina Live, el ícono de engranaje (Configuraciones) y el card
  del programa actual — nombre, badge Guardado/No guardado, y tres botones (guardado rápido, nuevo
  programa, administrar programas guardados) que abren `pages/programs/ProgramsModal.tsx`.
- **Columna 2** (arriba de Diapositivas): un único botón **EN VIVO** que llama a
  `lib/actions/playback.ts::goLive()` — manda lo que está en vista previa al proyector,
  reemplazando lo que hubiera. Es la única forma de cruzar de preview a vivo; no hay un segundo
  botón equivalente en ningún otro lado.
- **Columna 3** (arriba de Monitores): tres botones mutuamente excluyentes — **LOGO**, **NEGRO**,
  **EN VIVO** — que llaman a `setOverlay('logo'|'black'|'none')` **directamente** (no
  `toggleOverlay`: cada uno siempre fuerza su propio estado, nunca "des-marca" al tocarlo de
  nuevo). Son los tres estados posibles de lo que el proyector muestra por encima del contenido
  base. Los atajos de teclado B/L siguen usando `toggleOverlay` (comportamiento sin cambios).

Las tres columnas del `<main>` son **`grid-cols-3`** — anchos iguales, ninguna de las tres tareas
(explorar, montar, emitir) pesa visualmente más que las otras. No hay StatusBar ni indicador de
"proyector conectado/desconectado" en el TopBar — LIMPIAR, la selección de pantalla y abrir/cerrar
la proyección, el tema claro/oscuro y el idioma se movieron todos a
`pages/settings/SettingsModal.tsx`, detrás del ícono de engranaje que reemplaza el título de la
app.

Esa modal es un panel de categorías estilo Ajustes de macOS, no una lista plana: `Modal
size="2xl" height="tall"` (alto fijo grande — cambiar de categoría nunca redimensiona el diálogo)
con `Tabs variant="sidebar"` a la izquierda (`components/ui/tabs.tsx`, la misma primitiva de
`resources/`, con una tercera variante vertical) y, a la derecha, un panel scrolleable con una
`sections/<nombre>-section.tsx` por categoría. Dentro de cada sección, `FieldGroup` + `FieldRow`
(en `components/ui/`, promovidos ahí cuando el editor de escenas se volvió el segundo usuario)
agrupan filas relacionadas en una tarjeta con divisores; cada fila sigue la regla de siempre:
etiqueta (+ descripción opcional) a la izquierda, control(es) a la derecha, sin wrap.
Categorías de hoy: **Proyección** (pantalla, abrir/cerrar la ventana, logo, limpiar contenido en
vivo, transición, volumen inicial), **Diapositivas** (caché y calidad de conversión),
**Versículos** (cómo se VISTE un versículo, con su vista previa 16:9 arriba), **Biblia** (qué
versiones hay instaladas: importar, renombrar, por defecto, borrar), **Sistema** (tema, idioma,
carpetas, rendimiento) y **Acerca de** (logo, versión y carpeta de registros). Una configuración nueva entra en un grupo existente o crea uno dentro de su sección —
no se agrega una categoría sin necesidad.

«Versículos» y «Biblia» son dos categorías y no una con pestañas, que es como estuvieron primero:
el estilo es una sola clave de `settings` con una vista previa que quiere el panel entero, y las
versiones son una tabla. La lista de versiones se dibuja con los MISMOS `FieldRow` que el resto
de Ajustes (envueltos en `<li>` dentro de un `<ul class="divide-y">`), no con el `ListRow` denso
de los paneles de recursos: una fila de 32 px entre filas de 60 px es lo que hacía que esa
pantalla se leyera como otra aplicación. Por eso `FieldRow` acepta un `label` que es un nodo (el
`<Input>` del renombrado ocupa el lugar del nombre, sin cambiar la altura de la fila) y un
`leading` para el ícono. Las insignias («Incluida», «Por defecto») van al lado del nombre, nunca
en la columna de acciones: son de ancho variable y desde ahí corrían los tres botones a una `x`
distinta en cada fila.

`go-live-bar.tsx` no existe más: el `EN VIVO` que antes vivía entre los monitores LIVE y PREVIEW
ahora es el botón de la columna 2 del TopBar, y por eso las flechas de paginado de preview que
tenía (↑/↓ manual) tampoco existen — la columna central ya permite clickear cualquier diapositiva
o versículo, y las flechas del teclado (↑/↓, atajo global) cubren lo mismo.

### Pantalla y arranque de la proyección

`stores/display.store.ts` reemplaza al viejo hook `use-displays.ts`: lista las pantallas, resuelve
cuál usar (la persistida en `settings['projection.displayId']`, si sigue conectada; si no, la
primera no-primaria) y expone `open()/close()`. La app llama `open()` automáticamente al arrancar
(`app/App.tsx`) — **la ventana de proyección se abre sola y arranca en NEGRO**, nunca mostrando el
último contenido de un culto anterior. El operador corta/reinicia desde Configuraciones, no
manualmente desde el TopBar.

- **`schedule/`**: el orden del culto. Click = preview, doble click = en vivo, drag = reordenar.
- **`resources/`**: un solo browser con pestañas para **todo** lo proyectable, Biblia incluida
  (`variant="folder"` de `Tabs`). Un asset se puede previsualizar y proyectar sin estar en el
  programa — eso es lo que hace el área de recursos de EW.
- **`slides/`**: la grilla de lo que el ítem en preview puede poner en pantalla — diapositivas de
  un deck, versículos de un capítulo, o el propio archivo si es uno solo. Es también el único
  lugar que dispara conversiones (`useDeck`). Todo lo que puede crecer —las diapositivas de un
  deck, los versículos de un capítulo— se pinta con **`VirtualGrid`**, con la geometría en
  `components/ui/slide-grid.geometry.ts`: gap 12, ancho mínimo 144 para versículos y **2 columnas
  fijas** para un deck (`columns`, excluyente con `minItemWidth`), para que las diapositivas de un
  PPT se vean grandes en vez de una grilla chica de N columnas. `SlideGrid` (`slide-grid.tsx`)
  quedó sólo para las grillas de un tile que no crecen nunca: el versículo agendado, un ítem de
  texto, un asset suelto.
- **`monitors/`**: el monitor LIVE arriba (la primitiva `Monitor`; el de PREVIEW se mudó a la
  columna del centro, al lado de lo que previsualiza), debajo los transportes `deck-transport.tsx`
  y `verse-transport.tsx` como filas hermanas —nunca como footer del monitor, para que no puedan
  encoger el escenario—, y al final `live-content-grid.tsx`: la misma grilla que el centro, pero
  de lo que **está en el aire**. Click en un tile llama `gotoSlide()`/`projectVerse()` y salta ahí
  al instante (esto es vivo, no preview: no hay segunda etapa), y la grilla **sigue sola** al
  proyector (`scrollToIndex` de `VirtualGrid`), auto-avance incluido — virtualizada, un tile fuera
  de la ventana montada no existe, así que sin eso un deck largo dejaría al operador mirando una
  parte del culto que ya pasó. Es un componente distinto de `deck-slides.tsx`, que navega el deck
  *en preview*, no el que está en el aire.

### Flujo de dos etapas (estricto)

Seleccionar **nunca** proyecta. `lib/actions/preview.ts` mueve el target de preview y
`lib/actions/playback.ts::goLive()` es el único camino a `projection.store`. El cursor de preview
(`stores/preview.store.ts`) es independiente del cursor en vivo, así que se puede armar la
diapositiva 7 mientras la 3 sigue en pantalla.

Los atajos siguen la misma división: ←/→ mueven **lo que está en vivo**, ↑/↓ mueven **el
preview**, Enter cruza de uno al otro.

### `OutputView`, la primitiva que impide que un monitor mienta

`components/shared/output-view.tsx` renderiza un `ProjectionOutput` y lo usan **los tres**
lugares donde se ve contenido: la ventana de proyección (`mode="live"`) y los monitores LIVE y
PREVIEW (`mode="monitor"`). Los tamaños de texto están en `cqw` sobre un contenedor (`@container`),
no en `vw`, así que el mismo markup escala de un monitor de 240px a un proyector 4K sin variantes.
El monitor de preview es literalmente el renderer de proyección alimentado con otro input
(`lib/hooks/use-preview.ts::usePreviewOutput`).

## `presentation.html` → `ProjectionApp.tsx`

Los mismos 6 tipos de contenido relevantes de la legacy (`black`, `logo`, `image`, `video`,
`bible`, `text`) más `slide` (una imagen ya rasterizada del deck). El tipo
`text` legacy no tenía ningún caller — acá sí lo tiene (`ProgramItemDTO` con `kind:'text'`), así
que dejó de ser una feature muerta.
