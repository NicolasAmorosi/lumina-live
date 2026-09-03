## IPC three-file lockstep — resolved by the typed contract
**Area:** main | preload | renderer
**Trigger:** Adding, renaming, or removing any IPC channel (`window.worship`/`api.*`).

- The old three-file lockstep (`main.js`+`preload.js`+`app.js`, no compiler check) is gone.
  `src/shared/ipc/contract.ts` is the single source of truth; `src/main/ipc/index.ts` assembles
  every handler into an object typed as the full `Handlers` type — a missing or mis-typed
  handler is a **compile error**, not a `window.api.x is not a function` at runtime.
- `src/preload/index.ts` is generic (`invoke`/`on` by string channel) and never changes when a
  channel is added — see `docs/knowledge/02-ipc-contract.md` for the full pattern and why the
  generic preload is not a security hole.
- The old hardcoded `els[id]` array (`app.js:59-71`) is gone too — React refs/state replace it,
  nothing to forget to register.
- The `/add-ipc` skill was rewritten for this pattern — see `.claude/skills/add-ipc/SKILL.md`.

**Last updated:** 2026-09-02
