## `MediaStatus.ended` is sticky and its key is reused across plays — any consumer must check `epoch`
**Area:** renderer (`effects/end-of-playback.ts`, `stores/projection.store.ts`,
`projection/use-media-status-reporter.ts`)
**Trigger:** Before writing anything that reacts to `mediaStatus[...].ended` — auto-clearing on
end-of-playback, an auto-advance rule, a "this track finished" toast, etc.

- `el.ended` is a **sticky** DOM property: once a media element ends, it stays `true` until a
  `seek`/reload. `use-media-status-reporter.ts` calls `report()` unconditionally on mount (not
  only on the `ended` event), so a freshly mounted element for a *new* play can rebroadcast a
  stale `ended: true` from whatever the *previous* element at that same target reported last —
  before the new element's own state overwrites it.
- The deck's soundtrack target key never changes across different decks or different plays of
  the same deck: it's always the fixed string `audio:deck-soundtrack`
  (`DECK_SOUNDTRACK_TRACK_ID`, `stores/audio.store.ts`). A live video's target key
  (`"video"`) is likewise reused across every video ever sent live. So `mediaStatus["video"]`
  or `mediaStatus["audio:deck-soundtrack"]` can hold an `ended: true` left over from a play that
  is no longer live.
- The fix used in `effects/end-of-playback.ts` (added 2026-09-08, the "auto-clear a finished
  video/deck" feature): never trust `ended` alone. Compare `status.epoch` against the current
  epoch for that target — `base.epoch` for the video (`BaseContent` of kind `"video"`),
  `soundtrackEpoch` for the deck soundtrack (`projection.store.ts`) — and only act when they
  match. Verified live via CDP: sending a stale-epoch `ended: true` after a fresh EN VIVO left
  `base` untouched; the same message at the current epoch cleared it.
- Related: [`mediaStatus` must be keyed per target](media-status-is-per-target-not-a-single-slot.md)
  (why the record is keyed at all) and
  [`worship://` Range support + projector `<video>` lifecycle](worship-protocol-range-and-video-lifecycle.md)
  (why `videoUnderlay` carries its own `epoch` in the first place).

**Last updated:** 2026-09-08
