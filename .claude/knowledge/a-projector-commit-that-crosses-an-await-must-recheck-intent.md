## A commit to the projector that crosses an `await` must re-check that the operator has not moved on — and the counter that decides it cannot be module-private

**Area:** projection (`src/renderer/src/lib/actions/playback.ts`, `live-intent.ts`, `bible.ts`, `src/renderer/src/stores/display.store.ts`)
**Trigger:** "the projector changed by itself", "the BLACK I put up lifted on its own", or before
adding any action that writes `base`/`overlay` after an `await`.

Found on 2026-09-13 auditing feature #5 (Black/Logo/Live), which the media-chain audit never
covered — it does not name `playback.ts` once.

### What looked already handled, and was not

`goLiveWithDeck` carries a comment about ordering that reads like the async case was thought
through:

> the deck is fully ready BEFORE `base` changes, so hitting GO LIVE on a not-yet-converted file
> leaves whatever is currently on the projector untouched instead of cutting to black for the
> length of a conversion.

That is a real property and it solves the *opposite* problem: not blanking the projector *while*
converting. It says nothing about the moment the conversion lands. After
`await deckStore.ensure(assetId)` the commit ran unconditionally:

```ts
deck = await deckStore.ensure(assetId);   // seconds: a 400-slide deck, or an
                                          // interactive job preempting a background one
store.beginScene();
store.setBase({ kind: "deck", … });
store.setOverlay("none");                 // ← lifts BLACK/LOGO
```

The operator is not frozen for those seconds. They press BLACK because nothing is happening, or
send something else live, or navigate the verse on air — and when the conversion finished it
**lifted the overlay they had just put up and projected a deck they had abandoned**, mid-service.
`setOverlay("none")` is what makes it worse than a stale picture: it is the app overruling an
explicit blackout.

The same class had already been fixed one layer down and did not generalize: `deck.store.ts` keeps
a `generation` map with `isCurrent()` precisely because a cancelled `ensure()` kept writing its
result. That guard protects `byAssetId` — a store entry, not what the congregation sees.

### The rule

Every action that changes the projector claims an intent **before its first `await`** (the
operator's intent starts when they press, not when an IPC round-trip resolves); every commit that
crosses an `await` re-checks that its own is still the newest. Last thing the operator did wins.
Claim only once the change is certain — `advanceSlide` past the last slide must not cancel a
conversion the operator is still waiting on. Drop a superseded commit **silently**: the deck still
converted and shows as ready, and the LIVE monitor still shows exactly what is going out, so
nothing is lying to anyone.

### The half that cost the most: a module-private guard is an opt-out

The counter first lived as a `let liveIntent = 0` inside `playback.ts`. That quietly left two
writers outside it:

- `advanceVerse` → `projectVerse` (`lib/actions/bible.ts`) writes `base` directly. It is the verse
  twin of `advanceSlide`, which *did* claim.
- `display.store.open()` sets `setOverlay("black")` when opening the screen.

Neither can import from `playback.ts` — `playback.ts` imports `projectVerse` from `bible.ts`, so
it would be a cycle. **A guard a writer cannot reach is a guard that writer silently opts out
of**, and nothing about the code says so. It now lives in `lib/actions/live-intent.ts`, a module
that imports nothing and therefore cannot form a cycle with any writer.

Generalizes: a cross-cutting invariant enforced from inside one participant's module is only as
complete as that module's import graph allows.

**Last updated:** 2026-09-13
