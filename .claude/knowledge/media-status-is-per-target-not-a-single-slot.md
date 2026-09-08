## `mediaStatus` must be keyed per media element — a single slot silently mixes clocks
**Area:** renderer (`stores/projection.store.ts`, `effects/deck-autoplay.ts`,
`components/pages/monitors/*`) | shared (`shared/types/projection.ts`)
**Trigger:** Before adding a second thing that can play audio/video at once, or before reading
`mediaStatus` anywhere — a stale/wrong clock (deck transport ticking against the wrong media, a
progress bar showing another track's time) is the symptom.

- Before 2026-09-08, `projection.store`'s `mediaStatus` was a single `MediaStatus | null` slot
  shared by every reporting element (`ProjectionApp`'s `<video>` and its deck `<audio>`). Only
  one thing could ever play at a time back then, so "last write wins" happened to be correct.
- `components/pages/monitors/deck-transport.tsx` read that slot **without filtering by
  `target`**, on the (then-true) assumption there was only ever one kind of status in flight.
  This was a live, undetected bug: as soon as a second concurrent media element existed, the
  deck's time-to-next-slide bar would silently start reading the other element's clock.
- The fix generalizes: `mediaStatus` is now `Record<string, MediaStatus>`, keyed by
  `mediaTargetKey(target)` (`shared/types/projection.ts` — `"video"` or `"audio:<trackId>"`).
  Every consumer must read `mediaStatus[mediaTargetKey(theSpecificTarget)]`, never the whole
  record as if it were one status. `deck-autoplay.ts` and `deck-transport.tsx` both had to be
  updated to filter this way.
- Corollary for `useEffect`/dependency arrays: `MediaTarget` became a discriminated **object**
  (`{kind:"video"} | {kind:"audio", trackId}`) instead of a string literal. A hook that used to
  take `target: "video" | "audio"` as a stable primitive dependency (`use-media-status-reporter.ts`)
  had to be changed to take a primitive `trackId: string | null` instead and construct the
  `MediaTarget` object *inside* the effect body — passing the object itself as a dependency
  either re-runs the effect every render (fresh literal each time) or requires disabling
  `exhaustive-deps`, both worse than keeping the dependency primitive.
- Related: [`worship://` Range support + projector `<video>` lifecycle](worship-protocol-range-and-video-lifecycle.md)
  — the same session that added N simultaneous audio tracks also made a video's pause state
  (`VideoUnderlay.paused`) declarative instead of a `play`/`pause` command, for the same reason
  covered there (NEGRO/LOGO must not silently override an operator's explicit pause).

**Last updated:** 2026-09-08
