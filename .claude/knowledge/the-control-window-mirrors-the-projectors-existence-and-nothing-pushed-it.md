## `presentationOpen` mirrors a window owned by main, and nothing was pushing it — so the projector could die with the control window never finding out

**Area:** projection / ipc (`src/renderer/src/stores/display.store.ts`, `src/main/ipc/handlers/projection.ts`, `src/shared/ipc/contract.ts`)
**Trigger:** "GO LIVE / BLACK / LOGO stopped doing anything", the on-air dot blinking with nothing
on screen, or before relying on `presentationOpen` for any decision.

Found on 2026-09-13 auditing feature #5. Latent since the projection window existed.

### The claim

`presentationOpen` reads like "is there a projector". It was only ever written by
`display.store.open()`, `openIfNeeded()` and `close()` — i.e. **only when the control window
itself caused the change**. Main knew when the window died (`projectionState.clearWindowIf`, from
`win.on("closed")`) and had no way to say so: `IpcEvents` had no such channel at all.

**The absence of an event is invisible.** Every other failure mode in this app leaves something to
grep for — a handler, a listener, a `catch`. A missing channel leaves nothing, which is why five
sessions of audit over this code never surfaced it.

### Why the window can die without being asked to

`Menu.setApplicationMenu` is never called anywhere in `src/main/` (verify with
`grep -rn "Menu" src/main/`). Electron's default application menu is therefore active, and on
macOS it binds **⌘W to Close Window** — including the focused projection window. A crash of the
projection renderer produces the same state.

### What that cost

`openIfNeeded()` short-circuits on the flag (`if (presentationOpen) return`), so once it was stuck
`true`:

- GO LIVE, BLACK and LOGO all stopped reaching any projector **in complete silence** —
  `projection:show` still travelled to main, where `projectionState.getWindow()` returned `null`,
  which is a mute drop;
- `MonitorsColumn`'s `broadcasting = presentationOpen && overlay === "none" && base !== null` kept
  the on-air dot blinking and `useLiveStatus()` returned `""` instead of "disconnected" — the
  monitors lying to the operator, which `CLAUDE.md` forbids outright;
- the only recovery was Settings → Screen → "close" (which closes nothing but resets the flag) →
  "open". Nothing on screen hinted at it.

### The rule

A renderer flag that mirrors a resource owned by main needs a push for **every** way that resource
can disappear, not only the ones the renderer initiates. And that push has to be gated on identity
— `clearWindowIf` now returns whether it actually cleared, and only then is `projection-closed`
broadcast, or a reopen would announce the *old* window's death over the live new one. That is the
same trap as
[`a-replaced-windows-closed-listener-must-check-identity.md`](a-replaced-windows-closed-listener-must-check-identity.md),
reached from a different direction.

This is the mirror image of
[`main-cannot-know-what-is-live-under-an-overlay.md`](main-cannot-know-what-is-live-under-an-overlay.md):
that one is about main not being able to answer a question the control owns; this one is about the
control not being told a fact only main can know. Both boundaries leak silently, and in opposite
directions.

**Last updated:** 2026-09-13
