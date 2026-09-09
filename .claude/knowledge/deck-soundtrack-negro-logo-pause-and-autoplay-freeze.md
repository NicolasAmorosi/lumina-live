## Pausing a deck's soundtrack under NEGRO/LOGO also requires freezing slide auto-advance, or it desyncs

**Area:** renderer (`effects/projection-sync.ts`, `effects/deck-autoplay.ts`, `stores/audio.store.ts`)
**Trigger:** Any request to change how NEGRO/LOGO interacts with a deck's linked audio or its
auto-advance; any report of a PPT's slide being "ahead of" its music after leaving NEGRO/LOGO.

Until 2026-09-09, a deck's own soundtrack was deliberately exempt from NEGRO/LOGO — it kept
playing through the overlay, unlike the video underlay (`LiveVideo` in `output-view.tsx`), which
pauses and holds position. The product decision changed: the deck's soundtrack must now
pause/resume through NEGRO/LOGO exactly like a video. Two non-obvious traps appeared doing this.

### Trap 1 — don't mutate the store's `paused`, combine it at the wire boundary

`useAudioStore`'s `LiveAudioTrack.paused` is the operator's own explicit pause (set by
`pauseAutoplay`/`resumeAutoplay` in `deck-autoplay.ts`) and, like `VideoUnderlay.paused`, must
survive an overlay round-trip unchanged — otherwise clearing NEGRO would silently un-pause audio
the operator paused on purpose. The fix computes an *effective* paused only where
`AudioTrackPush` is built for IPC, in `projection-sync.ts`'s `toAudioTrackPush(track, covered)`:

```ts
paused: track.paused || (track.source === "deck" && covered)
```

`covered = useProjectionStore.getState().overlay !== "none"`, read fresh on every push — a
second subscription (`unsubscribeOverlayForAudio`, subscribed to `state.overlay`) exists purely
to re-run this push when only the overlay changes, since `useAudioStore.tracks` itself doesn't.
Only `source === "deck"` is affected; a standalone audio asset sent live still plays through
overlay by design (`audio.store.ts`'s own doc comment).

### Trap 2 — the auto-advance timer doesn't know the audio paused

`deck-autoplay.ts`'s `scheduleSynced`/`scheduleDetached` are wall-clock `setTimeout` chains. They
are *not* automatically stopped by the `<audio>` element pausing — `scheduleDetached` never looks
at audio state at all, and `scheduleSynced` is only re-armed from `media-status` events, one of
which fires the instant the cover pauses the element (a normal `pause` event) and would otherwise
reschedule a timeout against a clock that has already stopped advancing. Left unguarded: covering
a "synced"-mode deck freezes the audio but the slide index keeps ticking forward on wall time, so
uncovering reveals a slide ahead of where the frozen music actually is.

Fixed with `isFrozenByCover(state)` (`overlay !== "none" && !!liveDeck?.soundtrack`), checked in
three places: the top of `scheduleSynced` and `scheduleDetached`, and in the `media-status`
listener right before it would call `scheduleSynced` again. A new `overlay` subscription in
`startDeckAutoplay()` calls `clearTimer()` the instant the cover goes up (canceling whatever was
already pending) and, only in **detached** mode, re-arms `scheduleDetached()` on uncover — synced
mode needs no explicit re-arm, because the resumed `<audio>` element's own `play` event flows back
through `media-status` and reschedules itself.

A deck with no soundtrack is untouched by any of this (`isFrozenByCover` is `false` whenever
`liveDeck.soundtrack` is null), matching the pre-existing `liveDeck?.soundtrack` guard already
used by `pauseAutoplay`/`resumeAutoplay`/`restartDeck`.

See also [`worship-protocol-range-and-video-lifecycle.md`](worship-protocol-range-and-video-lifecycle.md)
for the video-side half of this pattern (`videoUnderlay`, `covered` vs. `paused`).

**Last updated:** 2026-09-09
