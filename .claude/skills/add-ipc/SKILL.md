---
name: add-ipc
description: Add a new IPC channel to WorshipApp using the typed contract in src/shared/ipc/contract.ts. Use when asked to add, wire, or expose a new capability from the Electron main process to the renderer.
user-invocable: true
tools: Read, Write, Edit, Bash, Glob, Grep
---

# /add-ipc — Add an IPC channel

Adds a new IPC channel following `docs/knowledge/02-ipc-contract.md`. The contract is typed
end-to-end — the compiler catches a missing or mis-typed handler, so this skill is about picking
good names and wiring the implementation, not about not-forgetting a file.

Arguments: `$ARGUMENTS` — describe the capability needed (e.g. "get the current window bounds",
"set audio volume"). If empty, ask the user what the channel should do.

---

## Steps

1. **Read the contract first.** Read `src/shared/ipc/contract.ts` to see the naming convention
   (`dominio:accion`, e.g. `bible:search`, `library:relocate`) and which domain the new channel
   belongs to (`displays` / `projection` / `files` / `ppt` / `bible` / `library` / `programs` /
   `settings`, or a new domain if none fits).
2. **Pick a channel name and request/response shape** consistent with the existing ones. Confirm
   with the user if the capability is ambiguous — don't guess business logic. Define any new
   request/response types in `src/shared/types/` if they don't already exist.
3. **Add the entry to `IpcContract`** in `src/shared/ipc/contract.ts`:
   ```ts
   "domain:action": { req: { ... }; res: ... };
   ```
4. **Implement the handler** in `src/main/ipc/handlers/<domain>.ts` (create the file if the
   domain is new), typed as `Pick<Handlers, "domain:action">` (or extending the existing `Pick`
   if the file already handles other channels of that domain).
5. **Register it** — add the new handlers object to the spread in `src/main/ipc/index.ts` if you
   created a new domain file. If you extended an existing one, nothing else to do here.
6. **If the channel is a push event** (main → renderer, like `display-content`), add it to
   `IpcEvents` instead of `IpcContract`, send it with `webContents.send(channel, payload)` from
   main, and consume it in the renderer with `useIpcEvent('channel-name', callback)`
   (`src/renderer/src/lib/hooks/use-ipc-event.ts`).
7. **(Optional, for readability)** Add a method to the matching domain object in
   `src/renderer/src/lib/api.ts` (`api.domain.action(...)`) — this is pure sugar over `invoke`,
   not a second definition of the contract.
8. **Call it from a component/store** — `await api.domain.action(...)`, or `await invoke(...)`
   directly if you skipped step 7.

## Verification (do this before declaring done)

- `npm run typecheck` — if you skipped step 4 or 5, or got a signature wrong, this fails with a
  clear "missing property" / "not assignable" error pointing at `main/ipc/index.ts`.
- `npm run lint`.
- Never `require('fs')`/`require('child_process')`/expose Node directly in the renderer or the
  preload — everything goes through a named handler in `src/main/ipc/handlers/`.
- The preload (`src/preload/index.ts`) should almost never need edits — if you find yourself
  editing it for a new channel, stop and re-read `docs/knowledge/02-ipc-contract.md`, you're
  probably reintroducing the old three-file pattern.
