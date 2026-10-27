## LibreOffice's PPTX export only writes `advTm` when the slide has a visual transition effect

**Area:** slides
**Trigger:** a legacy `.pps`/`.ppt` deck has no auto-advance in the app but PowerPoint advances it
fine; `timings_source` is `ooxml-converted` yet every `advance_ms` is NULL; touching
`readMetadata`/`mergeBinaryTimings` in `src/main/slides/deck-service.ts`, or
`ppt-binary.ts` / `backfill-timings.ts`.

- **The belief this replaces** (it was written in two entries here and in
  `docs/knowledge/03-slides-libreoffice.md`): "the `.pps → .pptx` upgrade pass preserves the
  auto-advance timings perfectly". **It does not.** LibreOffice's PPTX *export* filter only emits a
  `<p:transition>` element when the slide carries a visual transition EFFECT, and `advTm` is an
  attribute of that element — so a slide set to "no transition, advance after 27 s" comes out of
  the round-trip with **no `p:transition` at all**, and the 27 s is gone with it. Our parser is
  correct; there is genuinely nothing in the file to read.
- **The import is fine — only the PPTX export loses it.** The decisive experiment, on
  `~/Downloads/PPT test/Himnario Nuevo Cantado/051.pps`:
  `--convert-to odp` → `presentation:duration="PT15.958999999S"` on every slide;
  `--convert-to "pptx:Impress MS PowerPoint 2007 XML"` → zero `<p:transition>` elements.
  The discriminator is visible in the ODP itself: slides that survive carry a `smil:type`
  (`randomBarWipe`, `fade`), slides that lose their timing carry none. In the source binary it is
  `SlideShowSlideInfoAtom.effectType == 0`. The PDF export drops it the same way (no `/Trans`).
- **Measured, not sampled.** All 1226 `.pps` of the user's hymnal have auto-advance in the source;
  **222 lose it** (208 completely, 14 partially). Predicting "has timings in our DB" from "has a
  visual effect in the source" was right for **672 of 672** already-converted decks, 0
  disagreements. The affected numbers are identical in `Himnario Nuevo Cantado` and
  `Himnario Nuevo Instrumental`: `039, 041-048, 051-064, 205, 207-209, 220, 231, 406, 424, 429,
  448, 454-455, 500-503, 505, 521-528, 531-535, 538-542, 544, 546, 549, 556-593, 595-599`.
- **The fix reads the times out of the source OLE2 binary** (`src/main/slides/ppt-binary.ts`)
  and gap-fills the converted `.pptx`'s metadata in `mergeBinaryTimings`. It never overrides a value
  the `.pptx` already carries, and it **compares the two readings on every slide where both have a
  number — one disagreement past 1 s and the whole merge is abandoned**, because the two come from
  independent paths and a deck advancing on another slide's timing mid-service is worse than one
  that does not advance.
- **Two MS-PPT traps that cost the most time here:**
  - **`SlideShowSlideInfoAtom.fFlags` bits are NOT consecutive** — the format interleaves reserved
    bits. `fManualAdvance` is `0x0001`, `fHidden` `0x0004`, `fSound` `0x0010`, `fLoopSound`
    `0x0040`, `fStopSound` `0x0100`, **`fAutoAdvance` `0x0400`**, `fCursorVisible` `0x1000`.
    Reading them as bits 0..6 (the obvious guess, and the first thing tried) puts `fAutoAdvance` on
    `fLoopSound` and makes every deck look manual-only.
  - **`PP97_DUALSTORAGE`.** A `.ppt` saved for PowerPoint 95 and 97 at once keeps the **95** stream
    named `PowerPoint Document` at the root and the 97-format one — the record layout we parse —
    inside a storage of that name. Looking the stream up by name without walking the OLE directory
    tree picks the 95 one, whose records are a different format entirely. It was the only file of
    673 that came back unparseable (`Himnario Nuevo Cantado/044.ppt`, 6.1 MB).
- **Read the record stream, never the file.** In a `.pps` the images live in a separate `Pictures`
  stream: the records parsed are ~45 KB of a 1.4 MB file. Same rule and same reason as
  [a-pptx-is-random-access-and-inflatesync-needs-its-out-buffer.md](a-pptx-is-random-access-and-inflatesync-needs-its-out-buffer.md)
  — this runs on the thread that serves the projection window.
- **Presentation order must come from the documented path**, not from the order records sit in the
  stream: `Current User` → the most recent `UserEditAtom` → its `PersistDirectoryAtom` → the
  `SlideListWithText` whose `recInstance` is **0** (1 is masters, 2 is notes — reading the wrong one
  yields the masters' timings) → one `SlidePersistAtom` per slide, in order.
- **Already-converted decks are fixed in place, not reconverted.** The times live in the source, so
  `backfillDeckTimings()` re-reads them and `UPDATE`s rows that were NULL: **976 slides across 122
  decks in 42 ms**, versus the `SLIDES_CONVERTER_VERSION` bump that was the mechanism already at
  hand and would have meant reconverting the whole library for images that were already correct.
  See [converter-version-must-bump-with-pipeline-fixes.md](converter-version-must-bump-with-pipeline-fixes.md)
  for when that bump IS the right answer — it is when the *rendering* changed, not the metadata.

**Last updated:** 2026-09-13
