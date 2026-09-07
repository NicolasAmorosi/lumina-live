# 01 — Arquitectura

## Qué es

WorshipApp es una app Electron 36 con **TypeScript + React 19 + Vite**, empaquetada con
`electron-vite` (no vite+tsc a mano — ver "Por qué electron-vite" abajo). Tres procesos:

- **Main** (`src/main/`) — ventanas, DB SQLite, IPC, conversión de diapositivas con LibreOffice.
- **Preload** (`src/preload/index.ts`) — puente `contextBridge` genérico (`invoke`/`on` por
  string de canal), ~25 líneas que no cambian nunca al agregar funcionalidad.
- **Renderer de control** (`src/renderer/index.html` + `src/renderer/src/`) — toda la UI de la
  ventana de operador: React + Zustand + Tailwind.
- **Renderer de proyección** (`src/renderer/projection.html` + `src/renderer/src/projection/`) —
  deliberadamente sin lógica de dominio: una función pura del último `ProjectionOutput` recibido.

## Por qué `electron-vite`

El andamiaje de referencia (`church-presenter`, archivado) usaba Vite pelado + `tsc --watch` +
`concurrently`, y tenía 3 bugs de cadena de build nunca resueltos: `NODE_ENV` nunca se seteaba
(dev caía siempre a producción), el `outDir` del renderer no coincidía con lo que el main
buscaba, y faltaba `root` en la config de Vite. `electron-vite` resuelve los tres de fábrica:
detecta dev-server URL automáticamente (`process.env.ELECTRON_RENDERER_URL`), compila los tres
targets con sus propios `tsconfig`, externaliza `electron` y módulos nativos, y reinicia el main
en watch. Config completa en `electron.vite.config.ts` (raíz del repo).

## Dev vs. empaquetado

`src/main/windows/control-window.ts` y `projection-window.ts` deciden `loadURL` (dev, con HMR) vs.
`loadFile` (producción) mirando `app.isPackaged` + `process.env.ELECTRON_RENDERER_URL` — nunca
`NODE_ENV` a mano. **Todas** las rutas dependientes de empaquetado (dónde viven las migraciones,
los recursos de la Biblia, la DB de usuario) se resuelven en un único archivo,
`src/main/paths.ts` — no repitas `app.isPackaged ? ... : ...` en otro lado.

## Las dos ventanas

Igual que la versión legacy: `createControlWindow()` (1400×900, mínimo 1000×700, fondo
`#0b1929`) y `createProjectionWindow(displayId?)`, que se **recrea** (no se reutiliza) en cada
`projection:open` y cae a 800×600 centrada sin `alwaysOnTop` con un solo monitor conectado. La
sync de minimizar/restaurar entre ambas ventanas vive en `main/index.ts` (`wireMinimizeRestoreSync`).

Como la ventana de proyección se destruye y recrea, main guarda el último `ProjectionOutput`
enviado (`src/main/services/projection-state.ts`) y lo reenvía en `did-finish-load` — si no,
reabrir la proyección la deja en negro aunque el control crea que está proyectando algo.

## Seguridad de ventanas

`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, **`webSecurity: true`** (a
diferencia de accesos rápidos comunes en Electron, acá no se desactiva — ver
`02-ipc-contract.md` y el protocolo `worship://` para cómo se sirven archivos locales sin
necesitarlo). CSP declarada en ambos HTML.
