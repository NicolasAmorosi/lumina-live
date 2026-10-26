## A slide's SVG in EMU repaints only below 2^23 units, so a new slide must be a new tree
**Area:** renderer
**Trigger:** a slide drawn from its model shows part of an EARLIER slide (usually its right third); touching `ModelSlide`, `SlideView`'s keys, or anything that updates a mounted slide's SVG in place

- `SlideView` draws in the model's own units: `viewBox="0 0 <width EMU> <height EMU>"`, ~12–13 million
  wide. Mounted fresh, Chromium paints it right (the fidelity harness mounts every slide fresh).
- Reused — React keeping the same `<svg>`/`<image>` and only swapping `href` as the projector moved
  from one slide to the next — the new picture was painted only up to x ≈ 0.645 of a 4:3 slide's
  width, i.e. 8.39M EMU = 2^23; past that, the previous slide's pixels stayed on screen, stable at
  1000 ms (not a timing issue). Measured 2026-10-26 on a hymn-sheet deck (one full-slide RGBA PNG
  per slide): the DOM held only the new `<image>`, and the bytes `worship://`
  served were identical to the part in the zip. The 2^23 boundary is what was observed; the exact
  mechanism inside Chromium was not traced.
- Fix: `ModelSlide` keys `SlideView` by the slide's model url, so every slide is a new tree.
  Consequence: never update a mounted slide's SVG in place (an animation, a late-arriving picture,
  a restyle) without checking the right side of the slide repaints — or move the SVG off EMU to
  smaller user units first. That is also why `slide-models.ts` decodes every picture BEFORE handing
  a model out: a picture arriving after mount is exactly an in-place update.

**Last updated:** 2026-10-26
