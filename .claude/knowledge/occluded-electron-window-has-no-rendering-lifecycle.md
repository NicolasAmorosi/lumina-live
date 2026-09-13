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

**Last updated:** 2026-09-13
