## An occluded Electron window runs no rendering lifecycle, so any rAF- or ResizeObserver-driven UI probed over CDP looks broken
**Area:** renderer / build
**Trigger:** driving the app over the DevTools Protocol (or any automated UI probe) and finding that scrolling doesn't update, a `ResizeObserver` never fires, or React state changes seem not to render — while the same interaction works by hand.

- **Believed:** a `BrowserWindow` that has been `show()`n behaves like a visible page: setting
  `scrollTop` fires `scroll`, `requestAnimationFrame` runs, `ResizeObserver` delivers.

  **False when the window is behind other windows.** Measured on 2026-09-11 against the real
  app over `--remote-debugging-port=9222`:

  ```
  { frames: 0, hidden: true, visibilityState: "hidden" }   // 500 ms of rAF requests
  { scrollTop: 900, hits: 0 }                              // a scroll listener, 400 ms later
  ```

  `document.visibilityState` is `"hidden"` and the whole rendering lifecycle is frozen. Layout
  still works — `getBoundingClientRect()` is honest, which is why geometry measurements are
  valid — but everything driven by a frame is not.

- **What this cost:** `VirtualGrid`'s virtualization was reported as "not following the scroll"
  (mounted range stuck at index 0 after scrolling 6000 px) and its `ResizeObserver` as dead.
  Both were fine. `Page.bringToFront`, `Browser.setWindowBounds` (not implemented in Electron)
  and `osascript`-activating the process all failed to un-hide it.

- **The workaround that works:** `Page.captureScreenshot` forces a frame, which runs the
  rendering lifecycle once — rAF callbacks and `ResizeObserver` delivery included. So the probe
  loop becomes: change state → capture a throwaway screenshot → measure. With that, the same
  scroll test immediately reported the mounted range moving to index 395 with 55 tiles in the
  DOM out of 622.

- **Consequence.** Never conclude "this UI doesn't react" from a CDP probe without either a
  forced frame or a check of `document.visibilityState`. And never measure *timing* in such a
  window: React's scheduler defers work there, so "the grid took 999 ms to appear" is an
  artifact, not a latency. Geometry: trustworthy. Anything per-frame: only after a forced frame.

### The rest of the recipe (added 2026-09-13, after driving checks 1–3 of the media-chain audit)

- **Launch:** `npm run dev -- --remoteDebuggingPort=9222`. The control window's target url is
  `http://localhost:5173/` — **not** `…/index.html`, which matches nothing; the projector is
  `…/projection.html` and only exists once something is live. `Runtime.evaluate` with
  `returnByValue` + `awaitPromise` is all that is needed; Node's global `WebSocket` makes the
  driver dependency-free.
- **Force the frame from the DRIVER, between steps** — not inside one long `Runtime.evaluate`.
  Setting `scrollTop` and measuring 200 ms later in the same evaluate reports the *old* mounted
  range, because no frame ran in between. `scroll → Page.captureScreenshot → measure` as separate
  round-trips is what works.
- **Native dialogs cannot be driven, and do not need to be.** `bible:import` and `files.pick` open
  `dialog.showOpenDialog` in main, which CDP cannot touch. But the control window is a trusted
  sender, so `window.worship.invoke('library:add', { paths, kind })` puts a file in the library with
  no dialog at all, and `deck:cancel`, `projection:open`/`close` and `library:remove` are reachable
  the same way. Prefer the real UI for the thing under test and IPC only for the setup around it.
- **A deck that has no `slide_decks` row can still be an instant cache hit**, so you cannot pick a
  test subject by querying for assets without a row — see
  [deck-cache-is-content-addressed-but-status-is-asset-owned.md](deck-cache-is-content-addressed-but-status-is-asset-owned.md),
  which is a live bug in its own right. To get a real conversion to observe or cancel you need
  genuinely new bytes: re-zipping a `.pptx` with Python's `zipfile` (same entries, fresh hash)
  produces a valid deck the cache has never seen.
- **Editing `lib/i18n/messages/es.ts` blanks the window.** Vite hot-updates `i18n-provider.tsx` with
  it, the React context is re-created, and every consumer throws
  `useI18n must be used within I18nProvider`. This is what the five standing
  `react-refresh/only-export-components` lint warnings are about. Dev-only; a reload fixes it.

### Two more traps (added 2026-09-13, driving the feature-5 checklist)

- **`Runtime.evaluate` on a page that is about to disappear never answers.** `window.close()` and
  `location.reload()` evaluated with `awaitPromise: true` leave a pending request that no response
  ever settles, so the driver hangs forever — and `.catch()` cannot help, because the promise does
  not reject either. Send those frames fire-and-forget (write the JSON straight to the socket
  without registering a pending entry) and confirm the effect by polling `/json` for the target to
  disappear.
- **HMR does NOT re-register the effect layer, so an A/B of an `effects/*.ts` module is a lie.**
  `startProjectionEffects()` is called once from an `App.tsx` effect whose deps never change;
  editing `projection-sync.ts` hot-updates the module while the *previously registered*
  subscriptions and IPC listeners keep running the old closures. A change toggled this way appeared
  to have no effect at all, in both directions. Restart the whole app between arms
  (`pkill -f "electron-vite dev"` alone leaves the Electron child alive and holding port 9222 —
  also `pkill -f "<repo>/node_modules/electron/dist"`).
- **Run the app against a throwaway profile.** `npx electron-vite dev -- --remote-debugging-port=9222
  --user-data-dir=<tmp>` works (electron-vite rejects unknown options of its own, so the Electron
  flags must go after `--`), and it keeps test imports out of the user's real library. Note that a
  fresh profile has no logo configured, so the LOGO output legitimately reports
  `media error scene worship://logo`.
- **`isControl` must match the control window exactly.** `url.startsWith("http://localhost:5173/")`
  also matches the hidden `rasterizer.html` window, which has the same preload (so
  `window.worship.invoke` works there and IPC-based setup silently succeeds against the wrong
  target while every DOM query comes back empty).

- **`startsWith` is not "exactly" — use equality (added 2026-09-18).** The bullet above prescribes
  `url.startsWith("http://localhost:5173/")`, and that is still wrong once anything is live: the
  projector is `http://localhost:5173/projection.html`, which passes that check. A driver that
  picked the first match then read the PROJECTOR's DOM while sending clicks meant for the control
  window — every query came back empty and the panel looked unmounted, twice, before the url was
  printed. Match the control window by `url === "http://localhost:<port>/"` and nothing looser.
  And do not hardcode the port: a stale dev server holding 5173 makes Vite take **5174** silently,
  so read it out of the dev log (`grep -o "localhost:517[0-9]"`) instead of assuming.

### Two screens, a real quit, and three false alarms (added 2026-10-14, the two-screen rehearsal)

- **Prefer making the window visible over forcing frames.** Launch with
  `npx electron-vite dev -- --remote-debugging-port=9222 --user-data-dir=<profile>
  --disable-backgrounding-occluded-windows --disable-renderer-backgrounding --disable-background-timer-throttling`.
  The control window then reports `visibilityState: "visible"` and runs ~100 rAF frames per 500 ms even behind
  the terminal. That matches the field, where the operator is looking at it. Without these flags the occlusion
  does more than freeze rendering: **CDP input is delivered late**. A countdown armed with a mouse click and
  paused after `sleep(3000)` read **8 s** elapsed. With the flags it read 3.02 s for 3024 ms.
- **The projector on a second display is visible on its own**, so it needs none of this. With two screens,
  `display.store` resolves a stale `projection.displayId` to the first non-primary display. That is correct:
  the persisted id `7` from an older session resolved to the built-in panel.
- **A real quit is `osascript -e 'tell application "Electron" to quit'`.** That is the dev bundle's name. It
  goes through `before-quit` and the close guard exactly like ⌘Q, which CDP cannot send because menu
  accelerators never see `Input.dispatchKeyEvent`.
- **Never `pkill -f node_modules/electron/dist` while the close dialog is on screen.** The pattern also
  matches the `Electron Helper (Renderer)` processes, so the renderer dies, the main process waits forever on
  a decision that will not come (`hold` cleared the grace timer), and only `kill -9` ends it. Answer the
  dialog over CDP first, then quit.
- **False alarm 1: a 0-byte `worship.db-wal` plus `-shm` after an exit.** Apple's `/usr/bin/sqlite3`
  persists the WAL file by default and leaves that pair behind on its own. It is not the "`will-quit` never
  ran" tell from
  [vetoing-a-close-during-a-quit-cancels-the-quit.md](vetoing-a-close-during-a-quit-cancels-the-quit.md)
  unless the app was the last process to open the database.
- **False alarm 2: a fullscreen projector 33 px short on the built-in display** (`screenY 1113` on a display
  at `y 1080`, `923` tall instead of `956`). That is the MacBook notch: macOS lays fullscreen windows out below
  it and paints the strip black. Confirm with `screencapture -x -D 2 <file>` instead of trusting window
  geometry. An external projector has no notch.
- **After an HMR update, `await import("/src/…")` from CDP returns the ORIGINAL module.** The
  browser's module map is keyed by URL, and Vite re-imports updated modules under `?t=<stamp>`. So
  a driver that calls an action through a dynamic import keeps running the code from before the
  edit, while the components (which HMR re-imported) run the new one. On 2026-10-14 this made a
  fixed `saveCurrentProgram` look broken twice; `fetch("/src/…").text()` showed the new source the
  whole time. Reload the control window (`location.reload()`, fire-and-forget) or restart the app
  before verifying a change to a non-component module.
- **False alarm 3: a copied profile shows broken slides.** See
  [a-deck-cache-hit-checks-existence-but-the-protocol-checks-containment.md](a-deck-cache-hit-checks-existence-but-the-protocol-checks-containment.md).
  Repoint `cache_dir` before launching a clone.

**Last updated:** 2026-10-14
