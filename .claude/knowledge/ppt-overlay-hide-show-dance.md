## PowerPoint overlay hide/show dance
**Area:** main | renderer
**Trigger:** Touching NEGRO/LOGO toggles, or debugging why the projection window disappears/reappears during a PowerPoint slideshow.

- Same behavior as the legacy app, now expressed as a diff instead of imperative toggles: PPT's
  own slideshow takes over the physical display, so the projection window is hidden right before
  `ppt:open` starts it (`src/main/ipc/handlers/ppt.ts` → `com.openPresentation`).
- `src/renderer/src/effects/projection-effects.ts` is the ONLY place with this ordering logic
  now: it diffs the previous `ProjectionOutput` against the next one from `selectOutput()` and,
  on `leavingPpt`, calls `projection:setOverlayVisible(true)` **before** sending the new content;
  on `enteringPpt`, calls `setOverlayVisible(false)` **after** sending `{kind:'ppt'}`.
- Linked `.mp3` audio pause/resume lives in the same effect, keyed off `next.kind` being
  `'black'`/`'logo'` — see `setLinkedAudio()` in the same file.
- Any new content type added to `BaseContent`/`ProjectionOutput` (`shared/types/projection.ts`)
  automatically goes through `selectOutput`'s exhaustive switch — no separate registration step
  like the legacy `restorePrevious()` required.

**Last updated:** 2026-09-02
