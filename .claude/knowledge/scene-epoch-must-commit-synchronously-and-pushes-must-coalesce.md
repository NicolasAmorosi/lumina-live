## A one-shot "new scene" flag must be bumped at the sync commit, not at the top of the async action — and multi-`set()` actions must coalesce into one push
**Area:** projection (`stores/projection.store.ts`, `effects/projection-sync.ts`, `lib/actions/playback.ts`, `components/shared/output-view.tsx`)
**Trigger:** touching scene transitions/fades, adding a new one-shot epoch/flag to `projection.store`, or any report of a transition firing on the wrong change (or not firing at all) after a `goLive()`-shaped action.

- `sceneEpoch` (added for the projector's crossfade) is what tells `OutputView` "this is a
  genuinely new scene, fade" vs. "same scene, instant content swap" (a slide/verse advancing).
  The naive placement — bump it once at the very top of `goLive()` — is wrong: `goLive()` can
  still fail or resolve to a no-op after that point (asset not found, a PPT not yet converted,
  an audio-only asset that never touches `base`). In every one of those paths the epoch was
  already spent on a push that changes nothing visible, so the *next* real content change reuses
  a stale epoch and gets treated as "same scene" — an instant cut where a fade was expected.
  Fix: `beginScene()` is called at each function's own synchronous commit point (right before its
  `setBase`/`setOverlay`), never before the `await` that can still abort the whole action.

- Independently: `projection.store`'s actions often do several synchronous `set()` calls in a
  row (`goLiveWithDeck`: `setLiveDeck` → `setBase` → `setOverlay`). `projection-sync.ts`'s
  `useProjectionStore.subscribe(selectOutputMemo, ...)` fires once per `set()` that changes the
  memoized output — so without batching, the projection window briefly renders each intermediate
  state as its own `projection:show` push. Concretely, `clearLive()`'s `setOverlay("none")`
  running before `setBase(null)` pushed the *old* live content for one push before the logo.
  Harmless as an instantaneous cut; with a multi-hundred-ms fade in flight, it becomes a visible
  flash of stale content before the real target. Fix: `projection-sync.ts` now coalesces with
  `queueMicrotask` — every `set()` in the same synchronous action updates a `pendingOutput`
  variable, and only the *last* value per microtask is actually sent.

- A related, initially-wrong idea while building the crossfade itself: assuming the entering
  layer of a transition can always paint on top just by being later in the DOM (so the
  persistent `<video>` element, always rendered last, would always win). That only holds in one
  direction. Covering a live video with BLACK needs the incoming black layer *on top of* the
  video; uncovering needs the reverse (the video on top of the outgoing black layer). DOM order
  is fixed, but the winner isn't — it depends on which side of the transition each element is on.
  Fixed with an explicit `role: "entering" | "leaving" | "steady"` → small fixed `zIndex` map
  (`LAYER_Z`), computed per-render from which of the (at most two) stacked scene layers is
  `kind === "video"`, instead of any arithmetic on the raw (unboundedly-growing) scene epoch.

- A fourth case, found right after shipping the above: `beginScene()` being called correctly at
  a real commit point still isn't enough if the action then **forces** a field to a value it
  might already hold. `clearBaseContent()` (a row's own delete button) unconditionally did
  `setOverlay("logo")` after clearing `base` — reasonable when the overlay was `"none"` (the
  live content really did disappear, falling back to the logo), but wrong whenever BLACK/LOGO
  was already up: forcing `"logo"` while already on `"logo"` produced a visible logo→logo fade,
  and forcing it while on `"black"` silently kicked the operator OUT of BLACK into LOGO — a
  functional bug, not just a spurious animation, since `selectOutputWithoutUnderlay` already
  shows black/logo regardless of `base` and deleting what's underneath should be invisible. Fix:
  only touch `beginScene()`/`setOverlay` when the overlay was `"none"` beforehand — the one case
  that actually loses something visible. Additionally hardened `output-view.tsx` itself with a
  `sceneContentKey()` structural-equality check (output minus its `transition` field): even if a
  future action bumps the epoch without the picture actually changing (as `clearLive()` still
  latently can, if invoked while already on LOGO), the transition machinery now refuses to
  animate a scene into a byte-identical copy of itself, regardless of which call site caused it.

**Last updated:** 2026-09-10
