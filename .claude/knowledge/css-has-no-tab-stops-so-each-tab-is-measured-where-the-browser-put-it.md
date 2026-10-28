## CSS has no tab stops, so a slide's tabs are measured where the browser put them

**Area:** renderer
**Trigger:** indented lyrics or a «number ⇥ text» line landing far right or too far left; `placeTabs` in
`slide-text.tsx`, `Paragraph.tabs` in the model.

- Hymn and liturgy decks indent verse lines with tabs (`a:t` holding `\t\t`), against stops in
  `a:tabLst` (the master's levels, usually) and `defTabSz` past the last. With the `\t` left in the
  text, Chromium used its own `tab-size: 8` spaces: lines landed hundreds of EMU off, silently.
- Measured on the references: one tab put the text at exactly the first `a:tab pos` (542925), two at
  the second (901700) — positions are from the text box's inner left edge (after `lIns`), the same
  ruler as `marL`. A mid-line tab (`2⇥Serve the Lord`) goes to the next stop past the text before it.
- CSS can only do a fixed `tab-size`, so each `\t` is an empty inline-block whose width a layout
  effect sets in order, from where the browser actually laid it out (following real text widths and
  line breaks), written back in `cqw` so the slide scales without measuring again. Offsets, not
  client rects: a rotated shape skews the latter. Offsets are whole pixels, hence the 1.5 px slack
  so a tab already on a stop doesn't take the same stop again.
- The px-per-EMU scale is the paragraph's computed `font-size` over the size passed in, so the two must
  be the same number (the strut). When the strut became the paragraph's smallest size and
  `placeTabs` still got the first run's, tabs came out millions of pixels wide and Chromium stopped
  painting the slide — no error anywhere; the harness captured the PREVIOUS slide (a capture identical
  to its neighbour's is the tell). Widths are now also capped at the slide's width.
- On the 103 corpus slides with tabs: «wrong» 40 → 14, nothing regressed.

**Last updated:** 2026-10-28
