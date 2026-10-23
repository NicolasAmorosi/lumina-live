## `DeckDTO.timingsSource` says the source was *readable*, not that the deck *has* auto-advance
**Area:** slides, renderer
**Trigger:** touching anything that decides whether to tell the operator "this deck auto-advances" — a badge, a hint, a warning — for a PPT deck.

- `timingsSource` (`"ooxml" | "ooxml-converted" | "none"`, set in `runConversion()` /
  `readMetadata()` in `src/main/slides/deck-service.ts`) only certifies that the OOXML timing
  data was parseable *and* its slide count lined up with the rendered pages. It says nothing
  about whether any individual slide actually carries an `advTm` (auto-advance delay). A
  completely ordinary `.pptx` with zero auto-advance configured on any slide still parses fine
  and gets `timingsSource: "ooxml"`.
- The field that actually answers "does this deck auto-advance" is `DeckDTO.autoAdvance`
  (`src/main/db/repositories/slides.repo.ts`: `slides.some(s => s.advanceAfterMs !== null)`) —
  true only when at least one slide has a real timing. It was already being used correctly for
  `DeckTransport`'s autoplay controls (third column), but `DeckAudioStrip`'s "Auto-advance" badge
  (second/preview column, `src/renderer/src/components/pages/slides/deck-slides.tsx`) was gated
  on `timingsSource !== "none"` instead — so the badge showed on essentially every native
  `.pptx`, regardless of whether it had any real auto-advance timing.
- Fixed by switching the badge condition to `deck.autoAdvance`. Whenever a UI needs to say
  "this deck will advance itself," use `autoAdvance`; reserve `timingsSource` for diagnosing
  *why* auto-advance data is or isn't present (e.g. a legacy `.ppt` upgrade path, or a
  slide/page-count mismatch — see [converter-version-must-bump-with-pipeline-fixes](converter-version-must-bump-with-pipeline-fixes.md)).

**Last updated:** 2026-09-10
