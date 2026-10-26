## PowerPoint's text lines are 1.2 em with their own baseline rule, not CSS's half-leading

**Area:** renderer
**Trigger:** text drawn by `SlideView` (`slide-text.tsx`) sitting higher or lower than in
PowerPoint, line spacing other than 100%, `spcBef` on a first paragraph, lines taller than their
`line-height`.

- Measured in PowerPoint's own rendering (`gen-metrics.pptx`: six faces × 20/40 pt × 70%, 100%,
  200%, 60 pt exact) and **the same for every face**: a single line is **1.2 em** (not the font's
  ascent + descent); in percent spacing the first baseline sits at **0.955 em + 0.85 em per extra
  100%**; in exact spacing at **0.747 of the line**. CSS centres the glyphs in the line box
  (half-leading), so `SlideParagraph` moves each paragraph by the difference, using the face's
  ascent/descent as the browser measures it (`measureText().fontBoundingBoxAscent`).
- PowerPoint **ignores `spcBef` on the first paragraph** of a text body (12 pt, 50%, 30 pt and 100%
  all put paragraph 1 where 0 does). A percentage `spcBef`/`spcAft` is a share of the 1.2 em line.
- A paragraph's strut must use the run's face: with the default face (Times) under a Candara run,
  the two inline boxes align on the baseline with different ascent:descent and the line box grows
  — 48.4 px lines for a 47.5 px `line-height`, enough to move a centred block of 8 lines by 4 px.
- PowerPoint does **not** shrink a `<a:normAutofit/>` that has no `fontScale` when it lays a slide
  out (placeholders and text boxes alike, overflow ×1…×4): the stored scale is the whole truth,
  so the renderer never measures to shrink.

**Last updated:** 2026-10-26
