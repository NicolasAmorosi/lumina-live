## better-sqlite3 v13 ships N-API prebuilds — no native rebuild needed
**Area:** build | data
**Trigger:** Touching `better-sqlite3`, electron-builder packaging, or wondering why the DB
"just worked" without `electron-rebuild`/`install-app-deps`.

- `better-sqlite3@^13` (NOT `^12`) rewrote its native binding on Node-API (`node-addon-api`,
  `NAPI_VERSION=10`), which is ABI-stable across Node/Electron versions. The npm tarball ships 8
  prebuilt binaries (`darwin/win32/linux` × `x64/arm64`) and `lib/binding.js` picks the right one
  at runtime by `process.platform`/`process.arch`.
- Verified against Electron 36.4.0's embedded Node (22.15.1, NAPI 10): the package's declared
  minimum (`engines.node >= 22`) is exactly satisfied — this is the version floor, don't go
  lower.
- Consequence: `npm install` compiles nothing, and you can `npm run package:win` (cross-compile
  the Windows NSIS installer) from macOS without touching the native module at all.
- Only packaging requirement: `asarUnpack: ["**/node_modules/better-sqlite3/**"]` in
  `package.json > build` — the `.node` file can't be loaded from inside an asar archive.
- `node:sqlite` (built into Node 22/Electron 36) was evaluated and rejected: it's experimental
  and, verified with a real query, has **no FTS5** — a hard blocker for the accent-insensitive
  Bible search this app needs.

**Last updated:** 2026-09-02
