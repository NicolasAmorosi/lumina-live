# HANDOFF — Live video → PowerPoint hang (2026-09-08)

## Executive summary

User-reported bug: switching the projector from a live video to a live PowerPoint deck (or
vice versa) could leave the app permanently stuck, requiring a full restart. Investigated end
to end by driving the **actual running Electron app** through Chrome DevTools Protocol (CDP)
— not guesswork — and found **two distinct, real bugs**, both fixed and verified live:

1. A race that could silently drop the first `projection:show` push after opening the
   projector (fixed).
2. **The actual reported hang**: a stale-React-state bug that made the app try to convert a
   2.36 GB video file with LibreOffice as if it were a PowerPoint, blocking the real PPT
   conversion behind it in the single-job queue for up to 10 minutes (fixed).

Both fixes are done, `npm run typecheck` and `npm run lint` pass clean, and the exact original
repro (video live → preview PPT → EN VIVO → back to video → repeat) was run 3 times in a row
against the live app with no hang. **Nothing has been committed** — the user has not asked to
commit yet.

The `sysctlbyname for kern.hv_vmm_present failed with status -1` line the user originally
flagged in the logs is a **red herring**: it's routine Chromium video-hardware-decode-path
noise on Apple Silicon macOS, appears on every single app launch (confirmed at startup with no
user interaction at all), and is unrelated to either bug.

---

## UPDATE — later the same day: video playback had a THIRD, deeper root cause

The two fixes below are real and still in place, but they did **not** cover the user's follow-up
report ("the video plays for a second and pauses, by the third play it always breaks, and it
breaks when interleaved with a PowerPoint"). That turned out to be a **main-process bug, not a
renderer one**: `worship://`'s `serveFile` ignored the request's `Range` header (it delegated to
`net.fetch(file://…)` without forwarding headers), so seeking was structurally impossible for
every video and audio file in the app, and Chromium's media pipeline was fed **misaligned bytes**
whenever it re-requested at an offset — dying with `PIPELINE_ERROR_DECODE … -12909`
(`kVTVideoDecoderBadDataErr`).

Two theories were tried and rejected before that: hardware-decoder session churn, and a React
remount race. Both were plausible and both were wrong/incomplete. The single measurement that
settled it was reading `video.seekable` on the live element (`[0, 0]` = the source cannot seek
at all).

Full write-up, the measurement to run, the fix, and the verification matrix:
**[`.claude/knowledge/worship-protocol-range-and-video-lifecycle.md`](.claude/knowledge/worship-protocol-range-and-video-lifecycle.md)**.

That session also changed NEGRO/LOGO to **pause** a live video and hold its position (resuming
where it left off), at the user's explicit request — deliberately unlike a deck's soundtrack,
which keeps playing through an overlay. Files touched: `src/main/protocol/worship-protocol.ts`,
`src/renderer/src/components/shared/output-view.tsx`, plus `videoUnderlay` on `ProjectionOutput`
(`src/shared/types/projection.ts`, `stores/projection.store.ts`, `lib/hooks/use-preview.ts`,
`projection/ProjectionApp.tsx`). Still **uncommitted**, like everything below.

---

## Current state

- Working tree has 6 modified files (all reviewed above) plus the user's own larger,
  unrelated in-progress refactor that was already uncommitted in the tree before this session
  started (many renamed/deleted files under `components/pages/*` — not touched this session).
- No new dependencies added. No DB schema changes. No migrations.
- Sanity check: `npm run typecheck && npm run lint` — both clean (only 3 pre-existing
  `react-refresh/only-export-components` warnings, unrelated to this work).
- A dev instance may still be running in the background from this session
  (`npx electron-vite dev -- --remote-debugging-port=9222`, started from
  `/Users/nicolasamorosi/Projects/Personal/WorshipApp`). Check with
  `ps aux | grep "WorshipApp/node_modules/electron/dist/Electron.app \."` before starting a
  new one.

## Environment / how this was reproduced

- macOS, Apple Silicon (M3), app run via `npm run dev` (electron-vite dev server on
  `localhost:5173`).
- The DB used was the real `~/Library/Application Support/worship-app/worship.db` (dev
  userData, not a fixture) with a saved service named **"Culto"** containing exactly 2 items:
  - position 0: kind `ppt`, mediaAssetId `4` — "Experiencia misionero en Italia.pptx"
    (~4.5 MB, already converted to a 6-slide cached deck in earlier sessions)
  - position 1: kind `media`, mediaAssetId `7` — "Milano Marathon (FINALE).mp4" (~2.36 GB)
- **Reproduction technique** (worth reusing for future Electron UI bugs in this repo — no
  skill covers this yet, consider writing one): launch the dev app with remote debugging
  exposed, then drive it with a small Node script using the **built-in `WebSocket` global**
  (Node ≥ 21, no `ws` package needed) speaking raw Chrome DevTools Protocol:
  ```bash
  npx electron-vite dev -- --remote-debugging-port=9222
  # in another shell, once it's up:
  curl -s http://localhost:9222/json   # lists live page targets (control window, projection window)
  ```
  Connect a `WebSocket` to a target's `webSocketDebuggerUrl`, call `Runtime.enable`, then
  `Runtime.evaluate` with `awaitPromise:true, returnByValue:true` to click real DOM buttons
  (`Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === '...')
  .click()`) and to dynamically `import('/src/stores/whatever.store.ts')` to read live Zustand
  state directly from the running renderer — no code changes needed to inspect state. Console
  `error`-level logs surface via `Runtime.consoleAPICalled` events on the same socket. This is
  how both bugs below were pinned down with certainty instead of guessed at.

## Bugs found & fixed

### 1. First-push race on `projection:open` (secondary, but real)

**Symptom:** the very first video sent to a freshly-opened projection window could fail to
appear (projector stays black/on whatever it showed before), self-healing only on a second
attempt.

**Root cause:** `projection-state.ts` replayed the last known output to a newly (re)opened
projection window via a **one-shot `webContents.once("did-finish-load", ...)`** listener. In
dev, `did-finish-load` (top-level document loaded) reliably fires *before* the Vite/React
bundle has finished executing and `ProjectionApp`'s `onIpc("display-content", ...)` listener
has mounted. `goLive()` runs immediately after `openIfNeeded()` resolves — with no wait for the
window to actually be ready — so its `projection:show` push could race ahead of, or land in the
gap after, that one-shot replay: the once-listener could fire (with `lastOutput` still stale or
null) *before* the real content arrives, and by the time the real content is pushed, the
one-shot listener has already been consumed. `webContents.send()` to a renderer whose listener
isn't registered yet is a **silent drop**, not a queued delivery.

**Fix:** replaced the push-based replay with a **pull**. Added a `projection:getSnapshot` IPC
channel; `ProjectionApp` calls it once on mount (in addition to still subscribing to live
`display-content`/`deck-soundtrack` pushes), seeding its initial state from
`projectionState.getSnapshot()`. A `sawPush` flag in the mount effect makes sure a
late-resolving snapshot never overwrites a push that already arrived by the time the snapshot
IPC round-trip completes — order-independent, no timing assumption.

**Files:**
- `src/shared/ipc/contract.ts` — new `"projection:getSnapshot"` channel
- `src/main/services/projection-state.ts` — dropped the `did-finish-load` listener/replay,
  added `getSnapshot()`
- `src/main/ipc/handlers/projection.ts` — handler wiring
- `src/renderer/src/lib/api.ts` — `api.projection.getSnapshot()`
- `src/renderer/src/projection/ProjectionApp.tsx` — pull-on-mount + `sawPush` guard

**Verified:** fresh app launch → load "Culto" → preview video → EN VIVO worked on the very
first attempt (previously required a second click to recover), confirmed by inspecting the
projection window's live `<video>` element via CDP (`paused:false`, advancing `currentTime`,
`readyState:4`).

### 2. THE reported hang — stale React state feeds the wrong assetId into a PPT conversion

**Symptom (the one the user reported):** video live on the projector → click to preview the
PPT in the schedule → EN VIVO → the whole app effectively freezes on that action; the slide
panel gets stuck showing "Convirtiendo diapositivas… 6 de 6" (or "Preparando…") forever, no
error, no recovery short of restarting the app. Not an OS-level crash (no crash reports in
`~/Library/Logs/DiagnosticReports`, no GPU process death, all Electron processes stayed alive
and near-idle CPU) — a genuinely stuck promise.

**Root cause, confirmed by tracing:**
- `useMediaAsset(id)` (`src/renderer/src/lib/hooks/use-media-asset.ts`) kept its return value in
  a `useState` that is only updated **inside a `useEffect`**, which only runs *after* a render
  commits — one tick behind an `id` prop change, by React's own design.
- `usePreviewContent()` calls `useMediaAsset(scheduleAssetId)` to resolve the schedule item's
  media row. When the preview target switches from the live video (assetId `7`) to the PPT
  (assetId `4`), `scheduleAssetId` becomes `4` *immediately*, but the hook's returned `asset`
  object was still asset `7`'s (the video) for that one render — its own effect hadn't run yet
  to correct it.
- For that one render, `usePreviewContent()` therefore produced
  `{ kind: "deck", assetId: 7, ... }` — the **video's** id, mislabeled as a deck.
- `DeckSlides`'s `useDeck(7)` effect fired on that (momentarily correct-looking) prop and called
  `useDeckStore.getState().ensure(7)` for real, which IPCs to main's `deck:ensure` →
  `prepareDeck(7, false)`.
- Main has no way to know `7` is a video — it tries to convert it as a presentation:
  `hashFile()` synchronously SHA-256-hashes the entire 2.36 GB file (blocking, but not the
  actual hang), then `convertToPdf()` invokes LibreOffice on a video file, with a timeout from
  `convertTimeoutFor(sizeBytes)` = `min(600_000, 60_000 + ceil(bytes/1_000_000)*4_000)` ms —
  for 2.36 GB that's the **10-minute cap**.
- `deck-service.ts`'s `pump()` processes **exactly one conversion job at a time**. The bogus
  video-as-PPT job sat at the front of that queue for up to 10 minutes, during which the
  *real* PPT (asset `4`) conversion — already queued or about to be — could not even start,
  or (if it had already streamed some pages before this happened) could not finish, which is
  what the "6 de 6" stuck progress text was showing: the last real progress event that reached
  the renderer before the queue got wedged behind the spurious job.
- Confirmed by (temporarily) adding `console.error` stack-trace logging to
  `useDeckStore.ensure()` and to `usePreviewContent()`'s ppt branch, then reproducing live via
  the CDP harness: captured `ensure()` firing with `assetId: 7` and a stack trace pointing at
  `use-deck.ts:17`, immediately after clicking the PPT preview row, one render tick before
  `usePreviewContent` self-corrected to `assetId: 4`. All debug logging was removed after
  confirming root cause — no debug code remains in the tree.

**Fix:** rewrote `useMediaAsset` (`src/renderer/src/lib/hooks/use-media-asset.ts`) so its
return value is **always read synchronously from the module-level `cache` Map during render**
— never from a `useState` that can lag a render behind. A `useReducer`-based force-rerender is
used only to notify React once an *uncached* id's fetch resolves (populating the cache first,
then bumping a counter to trigger the next render, which reads the now-cached value). This
makes it structurally impossible for the hook to return a *different* id's data — it now
returns either the correct cached asset immediately, or `null` while it's loading (a real,
honest "not ready yet" state instead of a wrong one).

**File:** `src/renderer/src/lib/hooks/use-media-asset.ts` only.

**Verified:** ran 3 consecutive round trips of preview-video→EN VIVO→preview-PPT→EN VIVO
against the live app via the CDP harness. All 6 transitions completed correctly and
immediately (`selectOutput(...).kind` read directly from the live Zustand store went
`video`→`slide`→`video`→`slide`→`video`→`slide`, no hangs). Cross-checked against the actual
projection window's DOM (`<img src="worship://deck/5/1">` for the PPT, real `<video
src="worship://asset/7">` playing for the video) and the control window's slide panel showing
the normal "Diapositiva 1 / 6" grid — never "Convirtiendo…" stuck.

**Note for later:** no other hook in `src/renderer/src/lib/hooks/` uses this
`useState`-updated-only-in-effect pattern (checked via grep) — this was the only instance of
this class of bug in the codebase as of this session.

## Runbook — how to re-verify or continue

1. `cd /Users/nicolasamorosi/Projects/Personal/WorshipApp && npm run typecheck && npm run lint`
   — must stay clean.
2. `npm run dev` (electron-vite dev). Load a service containing at least one `ppt` item and one
   `media` (video) item — the "Culto" service in the current dev DB already has this
   (`Experiencia misionero en Italia.pptx` + `Milano Marathon (FINALE).mp4`).
3. Manual repro steps: preview the video row → EN VIVO → wait for it to actually play → preview
   the PPT row → EN VIVO. Expect an immediate transition to the PPT's first slide, both on the
   projector and in the control window's slide grid. Repeat in the other direction
   (PPT→video) and back a few times.
4. If you need to re-instrument to debug a *different* stuck-conversion report, the CDP
   technique above (spawn with `--remote-debugging-port=9222`, drive via raw `WebSocket` +
   `Runtime.evaluate`) is faster and more reliable than guessing — no code changes needed to
   read live store state via `import('/src/stores/<name>.store.ts')` in the page context.

## Pending / next steps

- **Not committed.** The user has not asked to commit; when they do, these two fixes are
  logically separate commits (the `projection:getSnapshot` race fix, and the `useMediaAsset`
  stale-state fix) if a clean history is wanted — or one commit if not. Do not commit without
  being asked.
- Consider (not done, not asked for): a defensive check in
  `src/main/slides/deck-service.ts#runConversion` to reject non-presentation file extensions
  before hashing/converting, so a *future* instance of "wrong assetId reaches `ensure()`" fails
  fast instead of blocking the queue for minutes. Flagged as a possible hardening follow-up,
  not implemented this session since the actual bug (wrong id being produced at all) is now
  fixed at the source.
- Consider writing a small reusable skill/script for the CDP-driven Electron reproduction
  technique described above, since it will likely be useful again in this repo.
