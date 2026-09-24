## One CDP `Runtime.evaluate` is one React commit, so clicking N things inside it exercises the app once, not N times

**Area:** build (verification), renderer
**Trigger:** a CDP measurement that drives the app by clicking several elements in a loop inside a
single `Runtime.evaluate`, and then reports that the behaviour under test "did not happen".

- **Believed:** clicking 42 library tiles in one `evaluate` puts 42 assets through the code path
  being measured. **False.** React batches every `setState` produced inside that one synchronous
  block into a single commit, so only the **last** click has an effect that survives: 42 clicks on
  tiles moved the preview target 42 times and left exactly **one** target mounted, which fetched
  one asset.

- Measured on 2026-09-14 while verifying `useMediaAsset`'s eviction (`M26`) against the real
  library: 42 tile clicks in one evaluate produced a cache of **3 entries**
  (`{"size":10,"keys":[4,9,7,27,5,10,1,827,833,812]}` — 7 of them pre-existing). The same 30
  clicks issued **one per `evaluate`, with ~90 ms between them**, produced 19 new entries and
  reproduced the defect exactly: 7 of 9 schedule rows collapsed to `"…"`.

- **So a probe that drives state must be one round trip per user action.** It is slower and it is
  the only honest shape: the thing under test is what a commit does, not what a click listener
  does. The same trap is why a "nothing happened" result from a bulk-driving probe must never be
  read as "the bug does not reproduce" — the probe did not reach the code.

- Two companions worth knowing before writing one of these:
  [occluded-electron-window-has-no-rendering-lifecycle.md](occluded-electron-window-has-no-rendering-lifecycle.md)
  (measure only after forcing a frame with `Page.captureScreenshot`), and
  [driving-a-native-open-panel-from-a-verification-script.md](driving-a-native-open-panel-from-a-verification-script.md),
  and [element-click-over-cdp-fakes-focus-visible-and-invents-focus-only-bugs.md](element-click-over-cdp-fakes-focus-visible-and-invents-focus-only-bugs.md)
  (`el.click()` is not a click for anything keyed off `:focus-visible`).
  Also: swapping a hook file that changes its **number of `useEffect` calls** while the dev server
  is up produces `Should have a queue. You are likely calling Hooks conditionally` from HMR — it is
  an artifact of the hot update, not a bug in the code being measured, and `Page.reload` clears it.

**Last updated:** 2026-09-21
