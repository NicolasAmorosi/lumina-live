## A fixed-width readout box inflates the visual gap around it, even with a uniform flex `gap`
**Area:** ui
**Trigger:** a row of icon + label + trailing controls looks unevenly spaced even though every
child shares the same Tailwind `gap-N`; especially `MediaTrackRow` (`src/renderer/src/components/shared/media-track-row.tsx`) and `DeckTransport` (`src/renderer/src/components/pages/monitors/deck-transport.tsx`).

- `MediaTrackRow`'s clock readouts used `w-10` (a fixed 40px box) for text like `0:34` (~26px
  wide) or `9:07`. `DeckTransport`'s slide counter used `w-12 text-center` for `1/6`. In both
  cases the box's own dead space — the difference between the box width and the actual glyph
  width — sits *inside* the flex item, right next to the row's real `gap-2`. The two stack, so
  the space the eye perceives between the play button and the clock, or the counter and the
  delete button, was visibly larger than the icon→label gap even though every flex child used
  the identical `gap-2`. Measuring with `getBoundingClientRect()` in a live CDP session
  confirmed it: box-to-box gap was a uniform 8px, but visible-glyph-to-visible-glyph gap was not.
- Two earlier attempts at "fix the spacing" failed because they treated the *gap* as the
  variable, not the box: removing `flex-1` from the label broke the trailing-button-group's
  fixed right alignment (buttons then trailed right after a short label instead of hugging the
  row's edge); wrapping the trailing controls in their own `gap-1` sub-group shrank the box-level
  gap uniformly, which visually crushed the scrubber against the digits instead of removing the
  actual dead space.
- The fix: size the box to the max content the row can actually produce, in `ch` units (which
  match `tabular-nums` digit width exactly) — a static `Record`/lookup keyed by the row's fixed
  `durationSeconds` (not the ticking `currentSeconds`), e.g. `w-[4ch]` / `w-[5ch]` / `w-[7ch]` for
  `formatClock`'s `m:ss` / `mm:ss` / `h:mm:ss` buckets. The box never resizes while the clock
  ticks (bucketed by duration, which is constant), and it carries no dead space, so the row's one
  flat `gap-2` reads as uniform everywhere. Same treatment for the PPT counter: drop `w-12
  text-center`, use `shrink-0 whitespace-nowrap tabular-nums` sized to content instead.
- Verified live in the app (no Playwright installed; drove it via a from-scratch ~70-line CDP
  script over `REMOTE_DEBUGGING_PORT=9222 npm run dev`, since Node ships a global `WebSocket`) —
  across two simultaneous audio tracks, video, image, PPT, and the preview bar, using the
  `Culto` service already seeded in the dev DB.

**Last updated:** 2026-09-08
