## Since v42 the `electron` package does not download its binary, and `electron-vite` never triggers the lazy download
**Area:** build
**Trigger:** `npm run dev` dying with `Error: Electron uninstall`, a fresh clone or a wiped `node_modules`, setting up CI, or bumping Electron across the 42 boundary.

- Electron 42 removed the `postinstall` script that used to fetch the platform binary. `npm install`
  now leaves `node_modules/electron` with **no `dist/` and no `path.txt`** — which is exactly the
  state the package's own `index.js` reports as "not installed". Nothing warns during the install:
  it succeeds, `typecheck`, `lint`, `db:smoke` and even **`electron-vite build` all pass**, because
  none of them need the binary. The failure surfaces only when something tries to *run* the app.
- The official replacement is lazy: *"the binary is downloaded the first time you run Electron in
  development mode"*. That is true only through the package's `cli.js` (`npx electron`).
  **`electron-vite` does not go through it** — `startElectron` calls its own `getElectronPath()`,
  which reads `path.txt` directly and throws. The message is the four-word
  `Error: Electron uninstall`, with a stack pointing into a bundled chunk and no mention of what is
  missing or how to get it. Nothing in the breaking-changes page for v42 connects the dots either;
  the fix lives in the *installation tutorial*, which is not where anyone looks when a dev server
  crashes.
- The fix is to stop relying on laziness and fetch it explicitly. The package ships a bin for it —
  `install-electron` (`node_modules/electron/install.js`) — so `package.json` carries:

  ```json
  "scripts": { "postinstall": "install-electron", … }
  ```

  It is idempotent (`isInstalled()` → `exit 0`), it honours `ELECTRON_MIRROR` /
  `electron_config_cache` / `ELECTRON_INSTALL_PLATFORM` / `ELECTRON_INSTALL_ARCH`, and it reuses the
  `@electron/get` cache, so a second project on the same machine pays nothing. Running it by hand is
  `npx install-electron`.
- **`electron-builder` is not affected and must not be "fixed" the same way.** It downloads its own
  per-platform zip through `@electron/get` while packaging (`• downloaded label=electron`), so
  `npm run package:*` works on a tree where `npm run dev` does not. That asymmetry is itself
  misleading while diagnosing: a green `package:dir` proves nothing about the dev path.
- Related ceiling worth knowing before touching the toolchain: `electron-vite@5` accepts Vite
  `^5 || ^6 || ^7`, while `@vitejs/plugin-react@6` **requires Vite 8**. The React plugin therefore
  cannot be bumped past 4.x until electron-vite supports Vite 8 — npm resolves it to a peer conflict,
  not to anything that reads as a version ceiling.
