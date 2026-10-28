## A SmartArt drawing part's root IS `dsp:drawing`, and the layout's lengths are millimetres

**Area:** slides
**Trigger:** SmartArt missing from a slide, or laid out at the wrong size; `readDiagram` in `reader.ts`,
`smartart.ts` and `smartart/`.

- `readDiagram` looked for a `dsp:drawing` element *inside* the drawing part, but the part's root is
  `dsp:drawing`: every diagram with a cached drawing was dropped and flagged «no drawing» — 57 of the
  corpus's 115 SmartArt slides. Separately, empty drawings are common (LibreOffice, some templates) and
  PowerPoint re-lays those out, so an empty `spTree` counts as missing. When a non-empty drawing exists
  PowerPoint shows it as cached and never re-lays it out (one test deck draws accent6 from its drawing
  while its colours part says accent1).
- Constraint units, checked against PowerPoint's own cached drawings: `val` lengths are **millimetres**; a
  length that refers to a font size reads the points as millimetres (`h = 0.82 × 30pt` is 24.6 mm); a
  text margin that refers to a font size uses real points (`lMarg 0.3 × 65pt` is 247650 EMU).
- An `lte`/`gte` only clamps against the node's own container; against another node PowerPoint ignores
  it (list1 overlaps 50%, not the 82% the constraint says). A bare `w`/`h` is zero only if nothing else
  sized the node; `ar` is width over height; `chOrder="t"` inherits down the tree; `nonAsst` means
  non-assistant nodes, not transitions; the last sibling transition hides unless `hideLastTrans="0"`.
- Each child's constraints are re-evaluated against the box its parent actually gave it (process3's
  `h = 1000 × w` only makes sense that way).
- SmartArt text takes its face from the quick style's `fontRef`, not from the presentation's default
  text style (an old deck's Times New Roman default otherwise wins).
- Result on the 115 SmartArt slides: median coarse 19.7 → 3.2, «wrong» 93 → 25.

**Last updated:** 2026-10-28
