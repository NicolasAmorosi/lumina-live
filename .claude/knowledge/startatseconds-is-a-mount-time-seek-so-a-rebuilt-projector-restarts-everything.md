## `startAtSeconds` is a mount-time seek, not a position — so rebuilding the projection window restarted every media element, and dragged a deck with a soundtrack back to slide 1

**Area:** projection / renderer (`src/renderer/src/lib/actions/live-positions.ts`, `src/renderer/src/effects/deck-autoplay.ts`, `src/main/services/projection-state.ts`)
**Trigger:** anything that destroys and recreates the projection window — ⌘W or a crash
(`projection-closed`), `display.store.close()`, or `setDisplayId()` moving the projector to
another screen. Also before adding any new field to `ProjectionOutput`/`AudioTrackPush` that the
projector applies "once, on mount".

Found on 2026-09-13 closing `M1` of the feature-5 audit
(`AUDIT-black-logo-2026-09-13`, internal).

### The claim

Main's snapshot (`projectionState.getSnapshot()`) makes a rebuilt projection window replay
exactly what was live, and that is the whole point of it. But `AudioTrackPush.startAtSeconds` and
`VideoUnderlay.startAtSeconds` are **where the element was told to begin**, applied once per mount
(`AudioTrackElement`'s effect keyed on `[track.epoch]`, `LiveVideo`'s on `[]`) and deliberately
never re-applied. Replaying them into a *fresh* window is therefore replaying the operator's
original choice, not the current position: a nine-minute backing track at 8:12 came back at the
point it was sent live.

Nothing in the snapshot is wrong. The value simply means something different to an element that
already exists than to one being built.

### The part that was worse than restarted audio

The audit's own diagnosis said the deck case was already covered — *"the deck's audio re-syncs
on its own through `deck-autoplay`"*. It does not. `deck-autoplay.ts` has exactly that
recovery:

```ts
// Reopening the projection window mid-deck gives us a fresh <audio> that
// starts at 0. Seek it back to where the current slide belongs …
if (seededEpoch !== state.soundtrackEpoch) { … }
```

`seededEpoch` is consumed by the **first** `media-status` of the deck's first play, and reopening
the window does not touch `soundtrackEpoch` (only `setLiveDeck` bumps it). So on a real reopen the
block never re-enters. The soundtrack then reports ~0, and "synced" mode derives the slide cursor
from the audio clock — `slideAtAudioTime(deck, 0)` returns 1, and `setSlideIndex(1)` throws the
deck back to its first slide in front of the congregation.

Measured A/B on the running app over CDP, 2026-09-13 (deck on slide 4, soundtrack at 95 s, window
killed with `window.close()`):

```
freeze disabled -> startAtSeconds: 0      | reopened at audio 6.8 s  | slide 1/5
freeze enabled  -> startAtSeconds: 97.32  | reopened at audio 104 s  | slide 4/5
```

### The rule

Anything the projector applies **once, at mount** has to be re-derived at the moment the window is
about to be rebuilt — it cannot be left to the snapshot. `freezeLivePositions()`
(`lib/actions/live-positions.ts`) folds the last reported `mediaStatus` back into
`startAtSeconds` for every audio track and for the live video, and is called from all three paths
that destroy the window. Three properties of it are load-bearing:

- **It runs in the control window**, from the last `mediaStatus` report (at most one `timeupdate`
  tick, ~250 ms, old). Main must not grow a second source of truth for this — see
  [`main-cannot-know-what-is-live-under-an-overlay.md`](main-cannot-know-what-is-live-under-an-overlay.md).
- **Every read is epoch-guarded** (`status.epoch === track.epoch`), the same guard as
  [`media-status-ended-is-sticky-check-epoch.md`](media-status-ended-is-sticky-check-epoch.md):
  the deck soundtrack reuses one status key across decks and plays, so an unguarded read writes
  the *previous* play's position as this one's resume point.
- **`epoch` is never bumped.** Bumping it is how you force a remount; here nothing should remount,
  because in the `setDisplayId` path the old window is still on screen when the freeze runs.

Ordering matters in that path: the freeze must happen **before** `api.projection.open()` is sent,
because the output push is coalesced into a microtask
([`scene-epoch-must-commit-synchronously-and-pushes-must-coalesce.md`](scene-epoch-must-commit-synchronously-and-pushes-must-coalesce.md))
and main has to hold the frozen values before it builds the new window.

**Last updated:** 2026-09-13
