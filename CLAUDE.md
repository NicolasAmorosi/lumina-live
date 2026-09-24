# CLAUDE.md — WorshipApp

Guía de trabajo para Claude Code en este repositorio. Léela antes de tocar código.

WorshipApp es una aplicación de proyección de escritorio para iglesias, desarrollada en
**Electron + TypeScript + React + Vite + Tailwind**, con **SQLite embebido** como backend,
pensada como reemplazo de EasyWorship. Controla dos ventanas — control y proyección — para
mostrar diapositivas de PowerPoint (convertidas con LibreOffice headless), video, imagen, audio y
versículos bíblicos (RV1960) durante un culto. Identidad visual: azul + blanco de la Iglesia Adventista del Séptimo Día, con tema
claro/oscuro conmutable (oscuro por defecto, pensado para operarse en una cabina a oscuras).

Es el sucesor directo de la versión vanilla JS de este mismo repo (conservada temporalmente en
`legacy/`, ver la sección **Legacy** al final) y, más atrás, de `church-presenter`
(`Projects/CLAUDE.md`, archivado).

---

## Reglas de interacción

- **Responde al usuario en ESPAÑOL.** El usuario trabaja en español.
- **Todo el código, comentarios y nombres en INGLÉS.** Sin excepciones.
- **La UI tiene i18n desde el arranque**, con `es` como único diccionario e idioma por defecto
  (`src/renderer/src/lib/i18n/`). Los textos de UI van siempre a través de `useT()` — nunca
  hardcodeados en un componente — aunque hoy solo exista el diccionario español.
- **No crees archivos de documentación (`.md`, README, docs) salvo que se pidan explícitamente.**
- Sé conciso. Da código directo, sin relleno.

## Certeza antes de código — 99% o preguntá

**Antes de escribir código no trivial hay que llegar a ~99% de certeza sobre lo que el usuario
quiere.** No se asume: se pregunta. Este proyecto tiene demasiadas decisiones invisibles
(qué pasa en el proyector, qué pasa con el audio del deck, qué ve el operador en el monitor)
como para adivinarlas.

El protocolo, en orden:

1. **Leé antes de preguntar.** Las preguntas se hacen sobre lo que el repo *no* contesta. Si la
   respuesta está en `CLAUDE.md`, en `docs/knowledge/`, en `.claude/knowledge/` o en el código,
   no es una pregunta: es una lectura pendiente.
2. **Enumerá los supuestos** que el pedido deja abiertos. Un supuesto es abierto cuando dos
   lecturas razonables del pedido llevan a implementaciones distintas.
3. **Preguntá con `AskUserQuestion`**, no en prosa: opciones concretas y mutuamente excluyentes,
   con la recomendada primera y el trade-off explícito en cada una. Agrupá todo lo que puedas en
   una sola tanda de preguntas en vez de gotearlas.
4. **Recién entonces implementá**, y decí de entrada bajo qué supuestos quedó resuelto lo que no
   se preguntó.

Preguntas que casi siempre hay que hacer en este proyecto, porque el pedido casi nunca las
responde:

- ¿El cambio afecta **lo que se proyecta** (`ProjectionOutput`) o solo la ventana de control?
- ¿Qué pasa si eso está **EN VIVO** en ese momento? ¿Y con NEGRO/LOGO encima?
- ¿Hace falta un **canal IPC nuevo** o alcanza con estado del renderer?
- ¿El comportamiento va en un **store**, en un **efecto** (`effects/`) o en una **acción**
  (`lib/actions/`)?
- ¿Va a `components/ui/` (visual reutilizable) o queda en la feature?

**Excepciones — acá se ejecuta directo, sin preguntar:** typos, renombres obvios, formato,
pedidos de solo lectura (explicar, buscar, auditar), y seguir una instrucción que el usuario ya
dio explícita y completa en el mismo mensaje. Si el usuario ya contestó algo, **no se
re-pregunta**: eso es fricción, no rigor.

Si aparece una duda a mitad de la implementación: hacé primero todo lo que no depende de la
respuesta, y preguntá por lo que sí depende. No se entrega nada a medias en silencio.

## Stack

| Capa | Tecnología |
|---|---|
| Build | `electron-vite` (main + preload + renderer en un solo config, HMR, dev-server URL correcto) |
| Lenguaje | TypeScript 5.9 estricto (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) |
| UI | React 19 + Tailwind v4 (`@theme inline`, sin `tailwind.config.js`) |
| Identidad | paleta y tipografía oficiales de la iglesia (ALPS / `adventist.design`): Denim + Noto Sans |
| Utilidades UI | `clsx` + `tailwind-merge` (`cn()`), `lucide-react` — **sin cva, sin Radix** |
| Estado | Zustand (slices por dominio) |
| DB | `better-sqlite3` (Node-API, sin rebuild nativo) + Drizzle ORM + FTS5 para la Biblia |
| Empaquetado | `electron-builder` (nsis / dmg / AppImage) |

## Estructura de carpetas

```
src/
├── shared/                    # ÚNICA fuente de verdad de tipos main↔renderer
│   ├── ipc/contract.ts        # IpcContract — un entry por canal, agrupado por dominio
│   ├── ipc/result.ts          # Result<T> / IpcError
│   ├── style-validators.ts    # lo que comparten TODOS los estilos (color, SceneTextStyle, fondo)
│   ├── scene-validators.ts    # lo propio de una escena de tiempo; bible-style-validators.ts, lo del versículo
│   ├── types/                 # DTOs: display, media, bible, bible-style, projection, program, settings
│   ├── constants.ts           # AssetKind, extensiones, timeouts de PPT
│   └── urls.ts                # assetUrl()/slideUrl() — tokens de capacidad, no rutas
├── main/
│   ├── index.ts                # entry: DB, migraciones, seed, IPC, ventanas
│   ├── paths.ts                 # dev vs. empaquetado, TODAS las rutas resueltas acá
│   ├── windows/                 # control-window.ts, projection-window.ts
│   ├── db/
│   │   ├── schema.ts             # tablas Drizzle
│   │   ├── client.ts             # apertura + pragmas de SQLite
│   │   ├── migrate.ts            # backup + migrate() al arrancar
│   │   ├── seed/                 # seed de la Biblia (FTS5 rebuild) + bible-formats/ (JSON,
│   │   │                         #   Zefania, USFX, OSIS, módulos SQLite; canon de 66 libros)
│   │   └── repositories/         # un repo por agregado (settings, media, bible, programs, history, slides)
│   ├── ipc/
│   │   ├── register.ts           # registerHandlers<Handlers> — exhaustividad forzada por TS
│   │   ├── index.ts               # ensambla todos los *.ts de handlers/
│   │   └── handlers/              # un archivo por dominio, mismo agrupamiento que el contrato
│   ├── protocol/worship-protocol.ts   # worship:// — sirve archivos por id, nunca por ruta
│   ├── slides/                    # libreoffice.ts (discovery+soffice), pptx-metadata.ts (OOXML),
│   │                              # rasterizer.ts (ventana oculta+pdfjs), deck-service.ts (cola+cache)
│   └── services/                  # repos.ts (registro), projection-state.ts, broadcast.ts
├── preload/
│   ├── index.ts                  # puente GENÉRICO invoke/on — nunca se edita al agregar canales
│   └── index.d.ts                # declare global { interface Window { worship: WorshipBridge } }
└── renderer/
    ├── index.html                 # ventana de control
    ├── projection.html            # ventana de proyección
    └── src/
        ├── main.tsx / projection.tsx    # entries
        ├── app/App.tsx                   # shell de la ventana de control
        ├── projection/ProjectionApp.tsx  # shell de la ventana de proyección (sin lógica de dominio)
        ├── components/
        │   ├── ui/          # primitivas del design system — barrel index.ts
        │   ├── shared/      # cross-feature: modal, panel, output-view (renderiza un ProjectionOutput),
        │   │                #   timer-scene + bible-scene (las dos escenas generadas), style-fields
        │   └── pages/       # una carpeta por feature:
        │       ├── layout/     # AppShell (grilla estilo EasyWorship), TopBar
        │       ├── schedule/   # el orden del culto (columna izq. arriba)
        │       ├── resources/  # browser con pestañas: Biblia | Videos | Imágenes | Audios | PPT
        │       ├── slides/     # grilla central de diapositivas/versículos del ítem en preview
        │       ├── monitors/   # columna der.: LIVE arriba, PREVIEW abajo, transporte del deck
        │       ├── settings/   # Ajustes; sections/bible/ = estilo del versículo + gestor de versiones
        │       └── programs/   # modal de programas guardados
        ├── stores/          # Zustand: program, toast, preview, projection, deck, bible,
        │                    #   library, settings, audio, display, ui
        ├── effects/         # projection-sync.ts + deck-autoplay.ts + end-of-playback.ts —
        │                    #   la lógica "con orden"
        └── lib/             # api.ts, ipc.ts, i18n/, utils.ts, hooks/, actions/ (cruza stores),
                             #   utility-output.ts + bible-output.ts (los dos constructores compartidos
                             #   entre selectOutput y el monitor de PREVIEW)
```

## Reutilización de componentes — no negociable

Esta es la regla central del sistema de componentes, calcado de
`libretto-villaaurora/apps/web/src/components`:

- **Ningún componente de `components/pages/**` escribe una clase de Tailwind de color, sombra,
  radio o tipografía a mano.** Todo sale de una primitiva de `components/ui/`. Si necesitás un
  botón, usás `<Button>`; si necesitás un color de acento, es un token semántico
  (`bg-primary`, `text-danger`, …), nunca un hex ni una clase `bg-[#2b6cb5]`.
- **Si algo visual se repite en dos features → sube a `components/ui/`.** Si algo con lógica de
  dominio se repite en dos features → sube a `components/shared/`. Una sola vez no justifica
  subirlo; la segunda vez sí.
- **Patrón de una primitiva** (ver `components/ui/button.tsx` como referencia canónica):
  `type Props = HTMLAttributes<...> & { ... }` (nunca `interface`), un `Record<Variant, string>` a
  nivel de módulo para las variantes, `ref` como prop normal (React 19, sin `forwardRef`), y
  `cn(base, variants[variant], className)` para componer.
- **Todos los colores/sombras/radios vienen de `styles/globals.css`** (`@theme inline` +
  `:root`/`[data-theme]`). Nunca un valor de color hardcodeado en un componente — ni siquiera
  "solo por ahora". Ver la tabla de tokens semánticos abajo.
- **Una primitiva que puede vivir dentro de una celda de grilla lleva `h-full` Y `w-full`.** No
  alcanza con uno: un `<button>` se dimensiona *shrink-to-fit* incluso siendo `display:flex`, así
  que en cuanto deja de ser el grid item (p. ej. envuelto por el `role="listitem"` de
  `VirtualGrid`) su ancho pasa a ser el de su propio contenido. Y si además una grilla calcula
  offsets a partir de su altura, ese número va en `components/ui/thumb-tile.geometry.ts`,
  impuesto por el CSS — nunca estimado desde él. Diagnóstico completo en
  [`.claude/knowledge/tile-height-uniformity-flex-min-height-and-grid-auto-rows.md`](.claude/knowledge/tile-height-uniformity-flex-min-height-and-grid-auto-rows.md).
- **Barrel exports**: `components/ui/index.ts` reexporta todo con named exports. Sin default
  exports en componentes.
- **Naming**: archivos `kebab-case` en `ui/` y sueltos; `PascalCase` para componentes dentro de
  subcarpetas de `shared/`/`pages/`; hooks `use-x.ts`; tipos `x.types.ts`.
- Antes de escribir un componente nuevo, **revisá `components/ui/index.ts`** — es muy probable
  que la primitiva que necesitás ya exista.

### Tokens semánticos (no usar los valores `--wa-*` directamente)

| Token | Uso |
|---|---|
| `bg-background` / `text-foreground` | fondo/texto base de la app |
| `bg-surface` / `bg-card` | paneles / tarjetas |
| `bg-muted` / `text-muted-foreground` | fondos y texto secundario |
| `text-subtle` | texto terciario (hints, placeholders) |
| `bg-primary` / `bg-primary-hover` | acento principal (azul adventista) |
| `bg-danger` / `bg-success` | estados |
| `bg-on-air` / `border-on-air` | **reservado**: esto está en el proyector AHORA (monitor LIVE, riel de la fila activa) |
| `bg-badge-{ppt,video,image,audio,bible}` | color por tipo de contenido en playlist/biblioteca |
| `text-{danger,primary,success,warning,badge-audio}-ink` | **ese color como TEXTO o ÍCONO** sobre una superficie de la app. No es lo mismo que el token pelado, que es un RELLENO (`bg-danger` + blanco encima): en el tema oscuro un rojo legible sobre `bg-card` es un rojo claro, y blanco sobre un rojo claro no se lee. Los dos roles tiran para lados opuestos y **no pueden ser un solo valor** |
| `shadow-surface` / `shadow-raised` / `shadow-overlay` | los ÚNICOS 3 niveles de elevación — cards / dropdowns-tooltips / modales-toasts |

El tema (`ui.theme` en `settings`, `data-theme` en `<html>`) redefine los `--wa-*`; los
componentes nunca necesitan saber en qué tema están.

**Regla derivada, no negociable: un color que se escribe como texto va siempre por su `-ink`.**
`text-danger`, `text-primary`, `text-success`, `text-warning` y `text-badge-audio` **no existen**
como clases de texto — quedaron entre 2,18:1 y 2,89:1 sobre `bg-card` en el tema oscuro, por debajo
del 3:1 que WCAG pide hasta para un ícono. Solo los cinco tonos que aparecen como texto o ícono
suelto tienen `-ink`; el resto de los badges únicamente pintan el tinte de `Badge`, que ya lleva
`text-foreground`. Cada `-ink` es su propio color de ALPS aclarado hacia blanco, igual que este
archivo ya interpola la rampa Denim para superficies oscuras que ALPS no define — `primary-ink` es
literalmente el Denim `#84adfc`.

Todos los valores de color salen del sistema de identidad oficial de la iglesia (familia **Denim**
+ colores de acento de ALPS) y la tipografía es **Noto Sans** self-hosted. Antes de agregar un
color nuevo, leé la tabla de la paleta en `docs/knowledge/06-ui-and-theme.md` — tiene que salir de
ahí, no inventarse.

## Base de conocimiento — léela según la tarea

| Archivo | Cuándo leerlo |
|---|---|
| [`docs/knowledge/01-architecture.md`](docs/knowledge/01-architecture.md) | electron-vite, las dos ventanas, dev vs. empaquetado, `paths.ts` |
| [`docs/knowledge/02-ipc-contract.md`](docs/knowledge/02-ipc-contract.md) | `IpcContract`, cómo agregar un canal, por qué el preload no cambia nunca |
| [`docs/knowledge/03-slides-libreoffice.md`](docs/knowledge/03-slides-libreoffice.md) | LibreOffice headless, parseo OOXML (timings/audio), rasterizado, cache de decks |
| [`docs/knowledge/04-renderer-state.md`](docs/knowledge/04-renderer-state.md) | Zustand, `selectOutput`, la capa de efectos |
| [`docs/knowledge/05-data-and-persistence.md`](docs/knowledge/05-data-and-persistence.md) | esquema SQLite, FTS5, migración de datos legacy, archivos faltantes |
| [`docs/knowledge/06-ui-and-theme.md`](docs/knowledge/06-ui-and-theme.md) | design system, tokens, layout de paneles |
| [`docs/knowledge/07-roadmap-and-debt.md`](docs/knowledge/07-roadmap-and-debt.md) | qué falta, qué se dejó fuera de alcance, deuda conocida |

También revisá [`.claude/knowledge/INDEX.md`](.claude/knowledge/INDEX.md) — hallazgos puntuales
que se van acumulando sesión a sesión.

### Las dos bases de conocimiento — frontera

Hay dos, y no son lo mismo. Escribir en la equivocada es cómo se pierde un hallazgo.

| | `docs/knowledge/` | `.claude/knowledge/` |
|---|---|---|
| Qué es | documentación **estructural** curada: cómo funciona el sistema hoy | hallazgos **atómicos** y fechados: qué nos sorprendió y qué aprendimos |
| Forma | 7 documentos temáticos, numerados, se **reescriben** cuando el sistema cambia | un archivo por hallazgo, `kebab-case`, se **acumulan** (append-only) + `INDEX.md` |
| Se lee | al empezar a trabajar en un área | cuando el síntoma o el archivo coincide con el **Trigger** de una entrada |
| Ejemplo | "así funciona el pipeline de slides" | "las diapositivas ocultas no se exportan al PDF, y `advTm` no está donde parece" |

Regla de **promoción**: un hallazgo que deja de ser una anécdota y se vuelve una regla del
sistema sube a `docs/knowledge/` (y a la sección de convenciones de este archivo si es
no-negociable). La entrada atómica se queda igual, como el diagnóstico detallado — es lo que ya
pasó con el header `Range` de `worship://`.

`HANDOFF.md` no es ninguna de las dos: es estado de una tarea en curso, no conocimiento.

## Ciclo de automejora — obligatorio, no opcional

Cada sesión tiene que dejar el proyecto mejor documentado de lo que lo encontró, o confirmar
explícitamente que no había nada que documentar.

**Al cerrar una tarea no trivial, decidí si surgió un hallazgo durable y registralo con
`/learn`** (`.claude/skills/learn/SKILL.md`, que ya lleva el formato y actualiza `INDEX.md`).

Un hallazgo califica si cumple **las tres**:

1. **No es derivable** del código, del `git log` ni de este archivo.
2. **Costó descubrirlo**: un supuesto equivocado, un error engañoso, una herramienta que se
   comportó distinto de su documentación, un fix que llevó varios intentos.
3. **Va a volver a importar**: condiciona un área entera (protocolo, slides, proyección, DB,
   empaquetado), no una línea.

No se registra: lo que hace un archivo, estructura que git ya versiona, una regla que ya está
acá o en `docs/knowledge/`, ni estado de tarea (eso es `HANDOFF.md`). **Cerrar el ciclo sin
escribir nada es un resultado válido** — nunca inventes una entrada para tener algo que mostrar.

Dos automatismos sostienen esto (`.claude/settings.json` → `.claude/hooks/`):

- `SessionStart` inyecta al contexto el protocolo de certeza, la barra mínima de verificación y
  el índice de hallazgos ya registrados.
- `Stop` avisa al usuario cuando hay cambios en `src/` y nada nuevo en `.claude/knowledge/`.
  Es solo un `systemMessage`, nunca bloquea el turno.

## Configuración de Claude en este repo

| Ruta | Qué es |
|---|---|
| `.claude/settings.json` | versionado: allowlist de comandos de verificación/solo-lectura, `deny` de `legacy/**` y de `rm -rf`, y los dos hooks del ciclo |
| `.claude/settings.local.json` | preferencias personales, no versionado |
| `.claude/hooks/` | los scripts que ejecutan los hooks (probables a mano: `echo '{}' \| ./.claude/hooks/<script>.sh`) |
| `.claude/skills/` | `/add-ipc`, `/audit-page`, `/commit`, `/learn` |
| `.claude/knowledge/` | hallazgos atómicos + `INDEX.md` |

Los comandos destructivos u outward-facing (`git commit`, `git push`, `npm install`,
`db:generate`, borrar archivos) **siguen pidiendo confirmación a propósito**. No los agregues al
allowlist.

## Comandos esenciales

```bash
npm install              # instala deps — better-sqlite3 trae binarios precompilados, no compila nada.
                          #   El `postinstall` baja además el binario de Electron: desde la v42 el
                          #   paquete ya NO lo hace solo, y sin él `npm run dev` muere con
                          #   `Error: Electron uninstall` mientras build/typecheck/lint pasan igual
npm run dev               # electron-vite dev (HMR en renderer, restart de main en watch)
npm run typecheck          # tsc --noEmit sobre node (main+preload+shared) y web (renderer+shared)
npm run lint                # eslint .
npm run test                 # vitest run — 280 casos en dos proyectos: `main` (Node: migraciones, seed,
                              #   FTS5, repos, borrador, validadores de settings y de escena, respaldo WAL,
                              #   zip reader, audio vinculado, urls, prune del historial, funciones de tiempo,
                              #   arrastre de una cuenta regresiva, escenas de tiempo como ítem del orden de culto,
                              #   video embebido en una diapositiva: geometría, rels externos y nodo por `spid`,
                              #   estilo del versículo, y los lectores de formatos de Biblia contra archivos
                              #   reales escritos al vuelo: Zefania, USFX, OSIS, módulos SQLite, Latin-1 y .zip)
                              #   y `renderer` (jsdom: selectOutput —incluido el video de diapositiva bajo
                              #   NEGRO—, el versículo vestido y su restilado en vivo,
                              #   freezeLivePositions, live-intent, transporte
                              #   de escenas de tiempo, el veredicto de «Probar video», el tamaño del
                              #   fotograma congelado, store de toasts, utils). Nada importa `electron`: ese es
                              #   el límite del suite
npm run test:watch            # el mismo suite en watch, mientras se toca un módulo
npm run db:generate            # drizzle-kit generate — nueva migración tras editar db/schema.ts
npm run slides:smoke -- x.pptx # conversión + parseo OOXML (timings/audio) SIN Electron
npm run build                 # electron-vite build
npm run package:win|mac|linux  # build + electron-builder para esa plataforma
```

## Convenciones que NO se negocian

- **Agregar un canal IPC = una línea en `src/shared/ipc/contract.ts` + una entrada en el
  `Handlers` de `src/main/ipc/index.ts`.** Si falta el handler o tiene la firma equivocada, no
  compila — no hay "olvidarse de un archivo" posible. El preload (`src/preload/index.ts`) es
  genérico y **nunca se toca** al agregar un canal.
- **`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webSecurity: true`** en
  ambas ventanas. No las cambies. Nunca `require()` en el renderer.
- **Los archivos locales se sirven por `worship://`** (`src/main/protocol/worship-protocol.ts`),
  resolviendo por id de `media_assets` o por sesión de slides — nunca por ruta de filesystem
  embebida en la URL. No reintroduzcas `file:///` construido a mano.
- **`serveFile()` DEBE honrar `Range` (206 + `Accept-Ranges`).** No lo "simplifiques" de vuelta a
  `net.fetch(file://…)`: eso ignora los headers, deja a todo video/audio **sin seek** y rompe la
  reproducción con `PIPELINE_ERROR_DECODE (-12909)` por datos desalineados. Diagnóstico completo en
  [`.claude/knowledge/worship-protocol-range-and-video-lifecycle.md`](.claude/knowledge/worship-protocol-range-and-video-lifecycle.md).
- **Cancelar un trabajo encolado SIEMPRE settlea su promesa.** Sacar un `Job` de una cola sin
  `inFlight.delete()` + `reject(CANCELED)` no lo cancela: deja una promesa que nunca resuelve y,
  peor, un zombi en el mapa de dedupe que devuelve esa misma promesa muerta para siempre —
  salteándose incluso el cache-hit, que está guardado por `!inFlight.has()`. Un job **corriendo**
  no necesita nada de eso (lo settlea `pump`). Diagnóstico en
  [`.claude/knowledge/canceling-a-queued-job-must-settle-it-or-it-poisons-the-dedupe-map.md`](.claude/knowledge/canceling-a-queued-job-must-settle-it-or-it-poisons-the-dedupe-map.md).
- **Un error de `jsx-a11y` sobre un contenedor que delega el teclado se suprime con su porqué, no
  se "arregla".** `Tabs`, `VirtualGrid`, `Select` y los centinelas de `Modal` manejan las teclas en
  el contenedor a propósito: el tab stop es la pestaña seleccionada, el tile enfocado o el
  disparador, y la regla lee **un elemento por vez**. Hacer focusable el contenedor agrega un tab
  stop que no lleva a nada, y un handler de teclado en un `role="option"` no puede dispararse
  nunca. Ver
  [`.claude/knowledge/jsx-a11y-reads-one-element-so-every-delegated-keyboard-pattern-is-an-error.md`](.claude/knowledge/jsx-a11y-reads-one-element-so-every-delegated-keyboard-pattern-is-an-error.md),
  que además tiene las dos trampas de la sintaxis `-- razón` del directive.
- **Nada de `dangerouslySetInnerHTML`, nunca.** Para resaltar coincidencias, la primitiva recibe
  **segmentos** (`{text, match}[]`), no un string con markup adentro — así la versión insegura ni
  siquiera se puede escribir. El caso que lo motivó: el `snippet()` de FTS5 envuelve el texto
  crudo del versículo, que sale de un JSON que importa el usuario, y el renderer tiene el puente
  IPC genérico. Ver
  [`.claude/knowledge/fts5-snippet-is-markup-wrapped-around-user-supplied-text.md`](.claude/knowledge/fts5-snippet-is-markup-wrapped-around-user-supplied-text.md).
- **El orden de culto sin guardar se espeja a SQLite solo (`program_draft`), y cerrar la ventana lo
  decide el control, no main.** `effects/draft-autosave.ts` escribe el borrador con debounce y
  `App` lo recupera al arrancar; era el único dato de usuario sin respaldo. Main **nunca** infiere
  si hay trabajo sin guardar: `windows/close-guard.ts` veta el primer `close`, emite
  `close-requested` y espera un `window:closeDecision`, con una gracia de 4 s para que un renderer
  colgado no vuelva la app incerrable. Ojo con el ciclo de vida: vetar un `close` durante un quit
  **cancela el quit entero** y `will-quit` no llega, así que reanudarlo es `app.quit()` y no
  `win.close()` — diagnóstico en
  [`.claude/knowledge/vetoing-a-close-during-a-quit-cancels-the-quit.md`](.claude/knowledge/vetoing-a-close-during-a-quit-cancels-the-quit.md).
- **El respaldo previo a una migración se toma con `VACUUM INTO` + `PRAGMA integrity_check`, nunca
  con `copyFileSync`.** La base corre en WAL: copiar solo `worship.db` pierde en silencio todo lo
  posterior al último checkpoint — medido, 5000 filas contra 4977 con un `-wal` caliente. Y la base
  se cierra en `will-quit` (`closeDatabase()`), que es lo que vacía el `-wal` en vez de dejarlo
  crecer entre sesiones.
- **El transporte de una escena de tiempo vive en la FILA, y la fila de al lado no puede mostrar
  otro número.** `UtilityTrackRow` (`components/shared/`) es el mismo control en PREVIEW y en EN
  VIVO — valor, arrancar/pausar, reiniciar, y la barra arrastrable sólo para la cuenta regresiva,
  la única herramienta con un total del que ser una posición. El reloj de una escena vive en dos
  lugares (`base.clock`, lo proyectado; `utility.store.run`, lo armado sin proyectar) y las dos
  filas pueden estar en pantalla a la vez: `clockForScene` los lee **en ese orden — lo proyectado
  gana** y `commitClock` (`lib/actions/utility.ts`) los escribe en el mismo, que es lo único que
  impide que un timer tenga dos valores. Por eso ninguna acción del transporte decide su
  transición y su destino a la vez: la transición es pura (`shared/timer.ts`), el destino es de
  `commitClock`. Y pausar lo que está EN VIVO **no** desarma el timer que el operador preparó para
  otra escena.
- **Editar lo que ya está EN VIVO parchea `base` en el lugar; nunca es una escena nueva.**
  `setTimerClock` (pausar, reanudar, reiniciar) y `setLiveScene` (el operador editó la escena que
  está proyectada) escriben sobre `base` sin tocar `sceneEpoch`, igual que `setVideoResumeAt`.
  Llamar a `beginScene()` ahí haría que el proyector se funda en una copia casi idéntica de sí
  mismo en pleno culto, y en el caso del reloj además reiniciaría la cuenta. Hay tests que lo
  afirman en `tests/renderer/select-output.test.ts`.
- **Una columna JSON se VALIDA al escribir y se NORMALIZA campo por campo al leer.** Las dos
  mitades no son intercambiables: main rechaza un `utility:create` que no describa una escena
  entera (`isUtilitySceneUpsert`) porque el operador todavía está mirando el formulario; y el repo
  normaliza al leer (`normalizeSceneStyle`) porque una fila que YA está guardada hay que mostrarla
  igual, y un color roto tiene que costar el color y no la escena — mucho menos el arranque. Misma
  disciplina que `DraftRepo.load` y el seed de la Biblia. Y lo que sale de un normalizador siempre
  pasa el validador, con un test que lo afirma. **Un campo nuevo que PARTE uno existente cae al
  valor hermano de la fila, no al default de la app**: `SceneEnd.message` (el tipo del mensaje
  final) se normaliza contra el `style.message` de esa misma fila, porque toda escena escrita
  antes dibujaba esa línea así — caer al default habría re-estilado en silencio cada escena ya
  vestida la primera vez que este build la leyó.
- **La ventana de proyección no tiene lógica de dominio.** Es una función pura del último
  `ProjectionOutput` recibido (`src/shared/types/projection.ts`). Si necesitás que "sepa" algo del
  culto, calculalo en el control y mandalo por `projection:show`.
- **Main tampoco sabe qué está en vivo, y no se le inventa una segunda fuente de verdad.**
  `selectOutput` es una proyección **con pérdida**: un deck tapado por NEGRO/LOGO y "no hay nada en
  vivo" llegan a main como el mismo `ProjectionOutput`. Cualquier decisión de main sobre "lo que
  está en vivo" (pins de desalojo, atribución de historial, rechazar una operación) o viaja dentro
  del output porque el proyector mismo la necesita —como `videoUnderlay`— o es del control. Un
  guard en main que acierta el 95% es peor que ninguno: el 5% es un rechazo que el operador no
  puede explicar ni saltear en pleno culto. Diagnóstico en
  [`.claude/knowledge/main-cannot-know-what-is-live-under-an-overlay.md`](.claude/knowledge/main-cannot-know-what-is-live-under-an-overlay.md).
- **Seleccionar NUNCA proyecta.** El flujo es de dos etapas, como EasyWorship: un click (en el
  programa, en un recurso, en un versículo o en una diapositiva) mueve el target de preview
  (`lib/actions/preview.ts` + `stores/preview.store.ts`), y `goLive()`
  (`lib/actions/playback.ts`) es el **único** camino de ahí al proyector — compartido por el botón
  EN VIVO, Enter y el doble click. No agregues un segundo camino a `projection.store`.
- **Los monitores usan el mismo renderer que el proyector.**
  `components/shared/output-view.tsx` (`OutputView`) es lo que pinta la ventana de proyección Y
  los monitores LIVE y PREVIEW. Si el preview y lo proyectado se pintan distinto, un monitor puede
  mentirle al operador — por eso hay un solo componente y los tamaños van en `cqw`.
- **Una grilla de contenido que puede crecer va por `VirtualGrid`, y si refleja algo en vivo tiene
  que seguirlo.** Las diapositivas de un deck y los versículos de un capítulo (176 en el Salmo 119,
  montados dos veces: preview y en vivo) usan `VirtualGrid` con la geometría de
  `components/ui/slide-grid.geometry.ts`; `SlideGrid` quedó sólo para las grillas de un tile. La
  segunda mitad no es opcional: virtualizar convierte "el tile quedó fuera de vista" en "el tile no
  existe", así que la grilla en vivo sigue al proyector y la del centro al cursor de preview
  (`scrollToIndex`), y sólo se mueve cuando ese índice cambia — un scroll manual del operador se
  respeta hasta la próxima diapositiva. Ojo con el teclado: un salto que cruza la ventana montada
  remonta el tile enfocado, ver
  [`.claude/knowledge/a-keyboard-jump-across-the-mounted-window-remounts-the-tile-it-focused.md`](.claude/knowledge/a-keyboard-jump-across-the-mounted-window-remounts-the-tile-it-focused.md).
- **Un archivo que el proyector no puede reproducir se reporta, nunca se pinta ahí.** El
  `<video>`/`<audio>`/`<img>` de la ventana de proyección tiene `onError` y manda
  `projection:reportMediaError`; el aviso (banda roja sobre el escenario, toast, fila marcada en el
  panel de medios) lo pinta **solo** la ventana de control — `OutputView` en `mode === "live"` no
  recibe `errorLabel` porque la congregación no puede ver un cartel de error. Y el aviso **no**
  cambia lo proyectado: qué hacer con un archivo roto lo decide el operador, no la app. Es la regla
  de "los monitores nunca le mienten al operador" aplicada al caso en que la mentira sería un
  escenario negro y silencioso.
- **Los tiempos de auto-avance de un `.ppt`/`.pps` legacy se leen del binario de origen, no del
  `.pptx` convertido.** El exportador de PPTX de LibreOffice solo escribe `<p:transition>` cuando la
  diapositiva tiene un efecto visual, y `advTm` es un atributo de ese elemento: sin efecto, el
  tiempo desaparece (222 de 1226 archivos del himnario real). `ppt-binary-timings.ts` los lee, y
  `mergeBinaryTimings` **solo rellena huecos y abandona el merge entero ante una sola discrepancia**
  con lo que el `.pptx` sí trajo — avanzar con el tiempo de otra diapositiva en pleno culto es peor
  que no avanzar. Diagnóstico en
  [`.claude/knowledge/libreoffice-pptx-export-drops-advtm-without-a-transition-effect.md`](.claude/knowledge/libreoffice-pptx-export-drops-advtm-without-a-transition-effect.md).
- **Un PDF es un deck y NO se convierte con LibreOffice.** Es el formato intermedio del pipeline,
  así que `runConversion` lo manda directo al rasterizador (`containerKind === "pdf"`) y
  `warmBatchPdfCache` lo saca del lote. `--convert-to pdf` sobre un `.pdf` lo importa a **Draw** y
  lo vuelve a dibujar — medido, 157 KB → 1,76 MB. De ahí se sigue que **un PDF se proyecta sin
  LibreOffice instalado**: la pregunta es `deckRequiresSoffice(ext)` y se hace por deck, nunca por
  entorno. Vive en el `AssetKind` `ppt` a propósito, porque en todo el renderer `kind === "ppt"`
  ya significa "esto es un deck". Diagnóstico en
  [`.claude/knowledge/a-pdf-source-breaks-two-assumptions-the-pipeline-made-about-its-own-output.md`](.claude/knowledge/a-pdf-source-breaks-two-assumptions-the-pipeline-made-about-its-own-output.md).
- **Nunca leas un `.pptx` entero para sacarle sus partes XML.** Un zip es de acceso aleatorio: va
  todo por `readZipEntries` (`src/main/slides/zip-reader.ts`), que lee el directorio central y solo
  los rangos pedidos. `unzipSync` con `filter` **no** evita el `readFileSync` de 200 MB, solo el
  inflate. Y si agregás un camino nuevo de lectura de entradas, pasale a `inflateSync` su buffer
  `out` con el tamaño que ya trae el directorio central. Diagnóstico y mediciones en
  [`.claude/knowledge/a-pptx-is-random-access-and-inflatesync-needs-its-out-buffer.md`](.claude/knowledge/a-pptx-is-random-access-and-inflatesync-needs-its-out-buffer.md).
- **En `before-quit` no corre nada asíncrono.** Ni un `setTimeout`, ni un callback, ni una promesa:
  el proceso ya se fue. La limpieza de salida es sincrónica y punto — por eso el SIGKILL de respaldo
  de `soffice` va en la misma llamada que el SIGTERM. Ver
  [`.claude/knowledge/nothing-asynchronous-survives-before-quit.md`](.claude/knowledge/nothing-asynchronous-survives-before-quit.md).
- **Lo que el proyector aplica UNA vez al montar hay que recalcularlo antes de reconstruir la
  ventana.** `startAtSeconds` (de `AudioTrackPush` y de `VideoUnderlay`) es un seek de montaje, no
  una posición: replicar el snapshot de main en una ventana nueva remonta cada elemento en el punto
  que el operador eligió al principio. `freezeLivePositions()` (`lib/actions/live-positions.ts`)
  pliega la última `mediaStatus` reportada ahí adentro, y lo llaman los tres caminos que destruyen
  la ventana (`projection-closed`, `display.store.close()`, el reopen de `setDisplayId`). Sin eso
  un deck con banda sonora no solo reiniciaba la música: el modo "synced" deriva el cursor de
  diapositiva del reloj de audio, así que volvía a la **diapositiva 1** en pleno culto. Diagnóstico
  en
  [`.claude/knowledge/startatseconds-is-a-mount-time-seek-so-a-rebuilt-projector-restarts-everything.md`](.claude/knowledge/startatseconds-is-a-mount-time-seek-so-a-rebuilt-projector-restarts-everything.md).
- **Todo lo que el proyector tiene que SOSTENER viaja dentro del `ProjectionOutput`; un
  `MediaCommand` es solo para lo que pasa una vez.** `paused`, `startAtSeconds` y `volume` son
  estado (`VideoUnderlay`/`AudioTrackPush`); `seek` y `restart` son órdenes. La prueba está en el
  remonte: un comando se pierde en cada epoch nuevo y en cada reconstrucción de la ventana, y deja
  al operador con un panel que muestra un nivel que la sala no escucha. Por eso el volumen de
  `M2` no se implementó sobre el `setVolume` que ya existía — ese comando se borró.
- **Un video embebido en una diapositiva viaja como `slideVideo`, al TOPE de `ProjectionOutput` y
  no adentro de la variante `slide`.** Bajo NEGRO el `kind` pasa a `"black"`, así que un video que
  viviera dentro de la variante desaparecería del push justo al taparlo — desmontando el elemento,
  perdiendo la posición y recreando el decoder en cada toggle. Se tapa con opacidad y se pausa,
  igual que `videoUnderlay`. Su `rect` está en fracciones de la DIAPOSITIVA, no del escenario: el
  `<img>` del slide es `object-contain` y letterboxea, así que el overlay reconstruye esa caja con
  `min(100cqw, ratio * 100cqh)` dentro de un contenedor propio `container-type: size` — el
  `@container` de la vista es `inline-size` y no da eje de bloque, de modo que un `cqh` suelto
  resuelve en silencio contra otra cosa. Diagnóstico en
  [`.claude/knowledge/an-overlay-on-a-slide-must-rebuild-the-object-contain-box-and-cqh-needs-container-type-size.md`](.claude/knowledge/an-overlay-on-a-slide-must-rebuild-the-object-contain-box-and-cqh-needs-container-type-size.md).
  La feature es solo de `.pptx`/`.ppsx`: un `.ppt`/`.pps` legacy pierde el video entero.
- **NEGRO/LOGO pausa un video en vivo y mantiene su posición; la pista de audio de un deck sigue
  sonando.** El `<video>` no se desmonta al taparlo (`videoUnderlay` en `ProjectionOutput` +
  `LiveVideo` en `output-view.tsx`) — solo se oculta y se pausa, y al destapar reanuda donde
  estaba. Son dos comportamientos deliberadamente distintos: el video se detiene, la música del
  deck no.
- **El versículo viaja VESTIDO, y su estilo es una clave de `settings`, no una fila.** La variante
  `bible` de `ProjectionOutput` lleva adentro su `BibleStyle` y su `backgroundUrl` resueltos, por
  la misma razón que los lleva una escena de tiempo: el proyector no resuelve nada y
  `projection-state.ts` reproduce ese valor tal cual. El estilo vive en `settings["bible.style"]`,
  `App` lo espeja a `projection.store` (como ya hace con las dos claves de transición) y por eso
  `selectOutput` puede seguir siendo función pura de ese store. Editarlo mientras hay un versículo
  EN VIVO llega al proyector al instante y **sin transición**: nada de eso toca `sceneEpoch`. Lo
  construye `bibleOutputFor`, compartido con el monitor de PREVIEW igual que `timerOutputFor`.
- **El tamaño del versículo se MIDE contra el escenario; el testamento sale de la POSICIÓN; el
  formato de un archivo sale de sus BYTES.** Las tres son la misma regla: no se deduce de un
  nombre. El auto-ajuste mide el bloque entero (la referencia está adentro) y su `ResizeObserver`
  observa el ESCENARIO, nunca el bloque —observarlo es un bucle por construcción—; el testamento
  es `index <= 39` y no una lista de abreviaturas, que es como 23 libros del Antiguo Testamento
  estuvieron guardados como `"NT"` desde el primer commit; y `detectBibleFormat` sniffea números
  mágicos y el elemento raíz, porque un módulo renombrado es lo normal. Los dos hallazgos:
  [`a-book-code-namespace-is-per-format-and-testament-was-never-derived-right.md`](.claude/knowledge/a-book-code-namespace-is-per-format-and-testament-was-never-derived-right.md)
  y
  [`a-bible-module-is-milestoned-xml-or-latin-1-or-sqlite-and-never-what-its-name-says.md`](.claude/knowledge/a-bible-module-is-milestoned-xml-or-latin-1-or-sqlite-and-never-what-its-name-says.md).
- **Nunca un `cqh` debajo de `OutputView`.** Su raíz es un contenedor `inline-size`: sin eje de
  bloque, un `cqh` no falla — resuelve en silencio contra el viewport chico, que en un monitor de
  confianza de 240 px es la ventana de control entera. Ya mordió dos veces (el overlay de video de
  una diapositiva, y el margen vertical de `TimerScene`). Si de verdad hace falta el eje vertical,
  va adentro de un envoltorio propio con `container-type: size`.
- **`selectOutput` (`src/renderer/src/stores/projection.store.ts`) es la única fuente de qué se
  proyecta.** Es un `switch` exhaustivo sobre `BaseContent` — agregar un tipo de contenido nuevo
  sin manejarlo ahí es un error de compilación, no un bug de runtime como el `restorePrevious()`
  legacy.
- **Las diapositivas son imágenes pre-rasterizadas, no un slideshow controlado.** Un `.pptx` se
  convierte una sola vez (LibreOffice → PDF → WebP por slide) y se cachea en
  `userData/slides-cache` + SQLite, direccionado por **hash de contenido**. La ventana de
  proyección nunca se esconde: NEGRO/LOGO son resultados normales de `selectOutput`. No
  reintroduzcas COM, PowerShell ni `assertWindows()`.
- **Nunca escribas datos de usuario dentro del bundle de la app.** La DB vive en
  `app.getPath('userData')/worship.db`; los recursos empaquetados (`resources/bibles/*.json`,
  `drizzle/*.sql`) son de solo lectura en producción — accedelos siempre vía `src/main/paths.ts`.
- Nombres de archivo `kebab-case` (componentes `PascalCase.tsx` dentro de sus carpetas). Vars y
  funciones `camelCase`.

## Legacy

`legacy/` contiene la versión vanilla JS completa (Electron sin bundler, `main.js`/`preload.js`/
`src/js/app.js`) que esta migración reemplaza. **No se toca ni se usa como dependencia de
runtime** — es solo referencia mientras se valida la paridad funcional. Se elimina por completo
una vez que:

1. ~~Validación en Windows con PowerPoint real.~~ **Ya no aplica**: el COM se eliminó y el
   pipeline de LibreOffice se verificó en macOS contra decks reales (incluido un `.ppt` binario
   de 52 diapositivas) más un fixture con auto-avance y audio embebido.
2. Se confirmó que los datos de `settings.json`/`media_library.json` (si existían) migraron
   correctamente a SQLite — esto ya corre automáticamente al primer arranque
   (`src/main/services/migrate-legacy-data.ts`).

Hasta ese momento, tratá cualquier duda sobre "cómo se comportaba antes" consultando `legacy/`,
no reimplementando desde cero.

## Notas operativas

- Se desarrolla y se verifica en macOS: ya no hay features exclusivas de Windows.
- Requiere **LibreOffice instalado** para convertir presentaciones (`brew install --cask libreoffice`).
  No se empaqueta; la app lo detecta y guía la instalación si falta.
- `git` está activo; commitea/pushea solo si el usuario lo pide.
- No hay CI configurado — es una decisión del usuario, no un pendiente.
  `npm run typecheck && npm run lint && npm run test` es la barra mínima antes de dar por buena
  una tarea, y corre a mano.
