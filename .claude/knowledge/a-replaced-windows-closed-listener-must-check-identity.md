## A `closed` listener on a window that gets replaced must check identity, or closing the old one unregisters the new one

**Area:** projection (`src/main/ipc/handlers/projection.ts`, `src/main/services/projection-state.ts`)
**Trigger:** "changed the output monitor and now the projector is frozen on the last thing",
`projection:close` doing nothing, or before writing any `win.on("closed", …)` for a window the app
recreates rather than reuses.

Found on 2026-09-11 during the media-chain audit. Latent since the projection window was made
recreate-on-open.

### The mechanism

`projection:open` closes whatever window exists and creates a new one:

```ts
const existing = projectionState.getWindow();
if (existing) existing.close();          // asynchronous
const win = createProjectionWindow(displayId);
projectionState.setWindow(win);          // the NEW window is registered here
win.on("closed", () => projectionState.setWindow(null));   // ← the bug
```

`BrowserWindow.close()` does not emit `closed` synchronously — it asks the window to close and the
event arrives later. By then `setWindow(win)` has already run, so the **old** window's listener
fires and clears the reference to the **new** one, which is alive and visible on screen.

From that point on `projectionState.getWindow()` is `null`, so:

- every `projection:show` is silently dropped — the projector keeps showing whatever was last on
  it, which during a service reads as "the app froze";
- `projection:close` closes nothing;
- `projection:mediaCommand` / `setAudioTracks` go nowhere either.

The correct pattern was already in this repo, in `slides/rasterizer.ts:85` (`if (window === win)
window = null`). The projection handler simply didn't copy it.

### The fix, and why `getWindow()` is the wrong thing to compare against

`projectionState.clearWindowIf(win)` compares against the **raw private field**, not against
`getWindow()`:

```ts
clearWindowIf(win: BrowserWindow): void {
  if (this.window === win) this.window = null;
}
```

`getWindow()` filters out destroyed windows, and by the time `closed` fires for the *current*
window it is already destroyed — so `getWindow() === win` is never true and the guard would leak
the reference instead of clearing it. Getting the guard right in the reopen case while breaking
the normal case is an easy second bug.

### The general rule

For any window the app recreates: capture the window object in the listener's closure and compare
identity before mutating shared state. Register the listener **after** the new window is stored,
and never assume `close()`'s side effects have landed by the time the next statement runs.

**Last updated:** 2026-09-11
