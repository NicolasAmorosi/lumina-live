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

## Tema claro/oscuro y paleta oficial adventista

`src/renderer/src/styles/globals.css` define **dos paletas físicas** (`--wa-*`, en `:root`/
`[data-theme="dark"]` y en `[data-theme="light"]`) mapeadas a **un solo set de tokens
semánticos** vía `@theme inline` (`--color-background`, `--color-primary`, etc.). Los componentes
solo referencian los tokens semánticos — nunca `--wa-*` directo — así el toggle de tema
(`settings.store.ts`, `data-theme` en `<html>`) no requiere tocar ningún componente.

Los valores salen del **sistema de identidad oficial de la Iglesia Adventista**. `adventist.design`
y `styleguide.adventist.io` bloquean el acceso automatizado (403), así que la fuente usable es
**ALPS** (Adventist Living Pattern System, `github.com/adventistchurch/alps`), que es la
implementación de referencia de esa identidad —
`src/documentation/core/colors/_config.tsx` tiene cada color con su hex, RGB, CMYK y Pantone:

| Familia | darker / dark / base / light / lighter |
|---|---|
| Denim (primaria acá) | `#04132b` · `#04132b` · `#2f557f` · `#2e6de7` · `#84adfc` |
| Bluejay | `#052252` · `#2f557f` · `#2e6de7` · `#84adfc` |
| Campfire `#cd4900`, Iris `#9013fe`, Ming `#007f98`, Tree Frog `#2b8500`, Forest `#355724`, Cave `#255760`, Emperor `#4b207f`, Scarlett `#d0021b` |
| Neutros | `#000` `#222222` `#4a4a4a` `#717171` `#f5f5f5` `#ffffff` |

Dos consecuencias que importan al tocar la paleta:

1. **ALPS no define superficies de UI oscura** (es un sistema web/print). El tema oscuro
   **interpola la rampa Denim** entre `#04132b` y `#2f557f` en lugar de inventar matices nuevos.
   Cualquier valor nuevo tiene que salir de esa rampa o de un color de la tabla.
2. **No hay paleta global oficial de "colores de estado"** más allá de los de la tabla: el rojo es
   Scarlett, el verde es Tree Frog (oscuro) / Forest (claro). El token `--color-on-air` (Scarlett)
   tiene **un solo significado reservado**: esto está en el proyector ahora mismo. No se usa para
   errores — eso es `--color-danger`.

Los badges por tipo de contenido también son colores de la tabla (ppt = Campfire, video = Iris /
Emperor, image = Tree Frog / Forest, audio = Ming / Cave, bible = Bluejay / Denim).

### Un color no puede ser relleno y texto a la vez — la rampa `-ink`

Un token de color tiene **dos roles incompatibles** y el tema oscuro los enfrenta: como **relleno**
(`bg-danger` con blanco encima) tiene que ser oscuro para que el blanco se lea; como **texto** sobre
`bg-card` (#123054) tiene que ser claro para leerse él. Con un solo valor, uno de los dos falla — y
el que fallaba era el texto: medido sobre los valores reales, `text-danger` daba **2,35:1**,
`text-primary` 2,83, `text-success` 2,83, `text-badge-audio` 2,85 y `text-warning` 2,89, todos por
debajo del 3:1 que WCAG pide hasta para un objeto gráfico, y muy lejos del 4,5:1 de texto chico.
El peor caso no era decorativo: era el aviso de "este archivo no se pudo reproducir" en
`MediaTrackRow`, justo lo que el operador tiene que leer a oscuras y de reojo.

Por eso hay una segunda familia, `--color-<tono>-ink`, para los **cinco tonos que aparecen como
texto o ícono suelto**. Mismo hue, aclarado hacia blanco — igual que el tema oscuro ya interpola
Denim para superficies que ALPS no define:

| Token | Oscuro | Derivación | Sobre `bg-card` |
|---|---|---|---|
| `--color-danger-ink` | `#e8808d` | Scarlett `#d0021b` + 50 % blanco | 2,35 → **5,01** |
| `--color-primary-ink` | `#84adfc` | Denim `#84adfc`, tal cual de ALPS | 2,83 → **5,94** |
| `--color-success-ink` | `#80b666` | Tree Frog `#2b8500` + 40 % | 2,83 → **5,58** |
| `--color-warning-ink` | `#e6a480` | Campfire `#cd4900` + 50 % | 2,89 → **6,33** |
| `--color-badge-audio-ink` | `#66b2c1` | Ming `#007f98` + 40 % | 2,85 → **5,52** |

En el tema claro `-ink` vale lo mismo que el relleno: ahí ya pasaba en todos los pares donde se usa.
Se parten igual, para que ningún componente tenga que saber en qué tema está.

Los otros badges **no** tienen `-ink` a propósito: solo se pintan como tinte de `Badge`, que desde
el arreglo `H7` lleva `text-foreground` (2,18–3,19 → 12,5–13,8). `--wa-text-muted` del tema oscuro
se subió en su lugar, de `#7089a8` a `#92aac8` (3,70 → 5,59 sobre `bg-card`), porque `text-subtle`
es texto y nada más — 32 usos, ninguno como fondo ni borde.

**Lo que queda abierto:** el tema **claro** roza el límite en dos pares que nadie había medido —
`--wa-warning` sobre `bg-muted` a 4,00 y `--wa-text-muted` sobre `bg-muted` a 4,22. No se tocó:
subirlos significa mover neutros de ALPS y colapsaría la jerarquía contra `--wa-text-secondary`
(`#4a4a4a`), que es una decisión de diseño, no un ajuste.

Oscuro es el default (`DEFAULT_SETTINGS['ui.theme']` en `shared/types/settings.ts`) — pensado
para operarse en una cabina de proyección a oscuras, igual que la versión legacy.

## Noto Sans self-hosted

**Noto Sans es la tipografía oficial de la iglesia** (Advent Sans es exclusiva de logos y
señalética, por eso no se usa acá). Se sirve desde `@fontsource-variable/noto-sans`, importado en
`main.tsx`/`projection.tsx` — no hay `@import` de Google Fonts: la app queda usable sin internet
desde el primer render, incluyendo en una iglesia sin conexión.

## Formularios: `FieldGroup`/`FieldRow`, y `ColorField`

`FieldGroup` + `FieldRow` (`components/ui/field.tsx`) son la forma de CUALQUIER pantalla de
opciones: un título, un recuadro con líneas divisorias y una fila por opción — etiqueta (con
descripción opcional) a la izquierda, su control a la derecha, sin envolver nunca. Nacieron dentro
de Ajustes como `SettingsGroup`/`SettingsRow` y subieron a `ui/` cuando el editor de escenas de
Utilidades fue el segundo consumidor: es literalmente la regla de reutilización de `CLAUDE.md`
disparándose. Se agrega una opción a un grupo existente, o se abre un grupo nuevo; nunca una lista
plana de filas.

`ColorField` es el control de color. Elige de la paleta oficial (las muestras son valores de la
tabla de ALPS de más arriba) o acepta un hex propio, y **solo emite `#rrggbb`** — una sola forma
canónica, porque dos escrituras del mismo color en la base es una comparación que falla sobre un
valor que el operador nunca ve. Abre su popover por portal con `computeMenuPosition`, igual que
`Select` y `Menu`, porque todo panel y todo diálogo de esta app recorta su overflow.

Los hex que aparecen en `color-field.tsx`, en `DEFAULT_SCENE_STYLE` y en `DEFAULT_BIBLE_STYLE`
**no violan** la regla de "nada de colores hardcodeados en un componente": son valores de
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

- **Columna 1** (arriba de Programa/Recursos): el ícono de engranaje (Configuraciones) y el card
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
versiones hay instaladas: importar, renombrar, por defecto, borrar) y **Sistema** (tema, idioma,
carpetas). Una configuración nueva entra en un grupo existente o crea uno dentro de su sección —
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
