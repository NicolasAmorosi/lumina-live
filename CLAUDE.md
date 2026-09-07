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

## Stack

| Capa | Tecnología |
|---|---|
| Build | `electron-vite` (main + preload + renderer en un solo config, HMR, dev-server URL correcto) |
| Lenguaje | TypeScript 5.9 estricto (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) |
| UI | React 19 + Tailwind v4 (`@theme inline`, sin `tailwind.config.js`) |
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
│   ├── types/                 # DTOs: display, media, bible, projection, service, settings
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
│   │   ├── seed/                 # parseo defensivo + seed de la Biblia (FTS5 rebuild)
│   │   └── repositories/         # un repo por agregado (settings, media, bible, services, history, slides)
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
        │   ├── shared/      # composiciones cross-feature (modal, panel)
        │   └── pages/       # una carpeta por feature (playlist, bible, preview, services...)
        ├── stores/          # Zustand: service, projection, bible, library, settings
        ├── effects/         # projection-effects.ts — la única lógica "con orden" que queda
        └── lib/             # api.ts, ipc.ts, i18n/, utils.ts, hooks/
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
| `bg-badge-{ppt,video,image,audio,bible}` | color por tipo de contenido en playlist/biblioteca |
| `shadow-surface` / `shadow-raised` / `shadow-overlay` | los ÚNICOS 3 niveles de elevación — cards / dropdowns-tooltips / modales-toasts |

El tema (`ui.theme` en `settings`, `data-theme` en `<html>`) redefine los `--wa-*`; los
componentes nunca necesitan saber en qué tema están.

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

## Comandos esenciales

```bash
npm install              # instala deps — better-sqlite3 trae binarios precompilados, no compila nada
npm run dev               # electron-vite dev (HMR en renderer, restart de main en watch)
npm run typecheck          # tsc --noEmit sobre node (main+preload+shared) y web (renderer+shared)
npm run lint                # eslint .
npm run db:generate          # drizzle-kit generate — nueva migración tras editar db/schema.ts
npm run db:smoke              # smoke test de la capa de datos SIN Electron (migraciones+seed+FTS5+CRUD)
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
- **La ventana de proyección no tiene lógica de dominio.** Es una función pura del último
  `ProjectionOutput` recibido (`src/shared/types/projection.ts`). Si necesitás que "sepa" algo del
  culto, calculalo en el control y mandalo por `projection:show`.
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
- No hay CI configurado. `npm run typecheck && npm run lint && npm run db:smoke` es la barra
  mínima antes de dar por buena una tarea.
