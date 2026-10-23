# 01 — Architecture

## What it is

WorshipApp is an Electron 44 app with **TypeScript + React 19 + Vite**, bundled with
`electron-vite` (not vite+tsc wired by hand — see "Why electron-vite" below). Three processes:

- **Main** (`src/main/`) — windows, SQLite DB, IPC, slide conversion with LibreOffice.
- **Preload** (`src/preload/index.ts`) — generic `contextBridge` bridge (`invoke`/`on` by
  channel string), ~35 lines that never change when features are added.
- **Control renderer** (`src/renderer/index.html` + `src/renderer/src/`) — the whole UI of the
  operator window: React + Zustand + Tailwind.
- **Projection renderer** (`src/renderer/projection.html` + `src/renderer/src/projection/`) —
  deliberately free of domain logic: a pure function of the last `ProjectionOutput` received.

## Why `electron-vite`

The reference scaffolding (`church-presenter`, archived) used bare Vite + `tsc --watch` +
`concurrently`, and had 3 build-chain bugs that were never fixed: `NODE_ENV` was never set
(dev always fell through to production), the renderer's `outDir` didn't match what main looked
for, and the Vite config was missing `root`. `electron-vite` fixes all three out of the box: it
detects the dev-server URL automatically (`process.env.ELECTRON_RENDERER_URL`), compiles the three
targets with their own `tsconfig`, externalizes `electron` and native modules, and restarts main
in watch mode. Full config in `electron.vite.config.ts` (repo root).

## Dev vs. packaged

`src/main/windows/control-window.ts` and `projection-window.ts` choose `loadURL` (dev, with HMR) vs.
`loadFile` (production) by looking at `app.isPackaged` + `process.env.ELECTRON_RENDERER_URL` — never
`NODE_ENV` by hand. **All** packaging-dependent paths (where the migrations, the Bible resources
and the user DB live) are resolved in a single file, `src/main/paths.ts` — don't repeat
`app.isPackaged ? ... : ...` anywhere else.

## The two windows

As in the legacy version (removed from the repo on 2026-10-22; still in git history at
`90d3821`): `createControlWindow()` (1400×900, minimum 1000×700, background `#162231`) and
`createProjectionWindow(displayId?)`, which is **recreated** (not reused) on every
`projection:open` and falls back to 800×600, centered, without `alwaysOnTop` when only one monitor
is connected. The minimize/restore sync between both windows lives in `main/index.ts`
(`wireMinimizeRestoreSync`).

Because the projection window is destroyed and recreated, main keeps the last `ProjectionOutput`
sent (`src/main/services/projection-state.ts`) and replays it on `did-finish-load` — otherwise,
reopening the projection leaves it black even though the control believes it is projecting
something.

## Window security

`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, **`webSecurity: true`** (unlike
common Electron shortcuts, it is not disabled here — see `02-ipc-contract.md` and the `worship://`
protocol for how local files are served without needing it). CSP declared in both HTML files.
