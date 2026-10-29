## PowerPoint's soft edge eats the shape from its outline in, and a glow under it keeps the whole outline

**Area:** renderer
**Trigger:** a soft-edged shape bigger or blurrier than PowerPoint's, a soft-edged shape that PowerPoint
doesn't draw at all, or a glow around one; `SoftEdge` and `Shape` in `SlideView.tsx`.

- Measured with `gen-softedge.pptx` (red rectangles 144×108 pt on white, so `1 - G/255` is the alpha;
  radii 6 to 100 pt, alone and with a glow): at every radius the 50% contour sits **0.92·r inside** the
  outline and the 10–90% ramp is **0.8·r** wide. That is the outline eroded by 0.92·r and blurred with
  σ = 0.31·r; our profiles now match PowerPoint's within 0.03 at every sample.
- The first model (erode r/2, σ = 0.4·r, «a straight ramp over the radius») was half as deep: a
  6 pt soft edge was already 0.9 opaque 6 pt in, against PowerPoint's 0.58, and big radii kept a
  visible shape where PowerPoint draws none.
- **Past half the short side nothing is left**: 72 and 100 pt on a 108 pt-tall shape leave the slide
  blank, glow included. Real hymn decks put `softEdge rad="1270000"` (100 pt) on 240 pt-tall lyric
  boxes: what PowerPoint shows there is mostly the glow.
- **A glow under a soft edge is the whole outline's**, drawn behind the faded shape (a full-size halo
  around a shrunken blob), not a glow of the faded result. CSS `drop-shadow` on the SVG derives it from
  the faded result, so with a soft edge the glow is drawn in the SVG from the original paths instead.
- On the 112 corpus slides with a soft edge: mean coarse 10.6 → 7.0 (the hymn decks −10 each), worst
  regression +0.6.

**Last updated:** 2026-10-28
