## Anything positioned over the slide has to rebuild `object-contain`'s box, and `cqh` does not exist under the view's `inline-size` container
**Area:** renderer, ui, projection
**Trigger:** placing ANY element at slide coordinates over `OutputView`'s slide `<img>` — an embedded video, an annotation, a lower third, the planned Overlays feature. Also whenever a `cqh`/`cqmin` unit is about to be written anywhere in `output-view.tsx`.

- **Believed:** the stage is the slide, so a rect expressed in slide fractions can be applied with `left: x%` against the view's root. **False, and invisibly so:** the slide is painted by `<img className="size-full object-contain">`, which letterboxes whenever the projector's shape differs from the deck's. Measured on 2026-09-20 on a 1470×923 stage with a 16:9 deck: the image occupies 1470×826.9 with a **48 px** bar top and bottom, so a rect applied to the stage lands ~48 px off vertically — right on a 16:9 projector, wrong on every other one, which is exactly the kind of defect that only shows up in the room.

- **The box has to be reconstructed**, and the formula is `min(100cqw, ratio * 100cqh)` for the width plus `aspect-ratio: ratio` for the height — literally what `object-contain` computes. Verified against both a synthetic fixture and a real PowerPoint deck: expected `(367.5, 254.8, 735×413.4)` vs. rendered `(368, 255, 735×413)`, and `(132.8, 122.7, 1204.5×677.5)` vs. `(133, 123, 1204×678)`.

- **The trap is `cqh`.** Tailwind's `@container` (on `OutputView`'s root) is `container-type: inline-size`, which provides `cqw` and **nothing on the block axis** — every `cqh` in a descendant silently resolves against the *viewport-ish* fallback instead of erroring. The formula therefore needs its own wrapper carrying `container-type: size`, which is legal here only because the wrapper is `absolute inset-0` and so has a definite size on both axes. That private container shadows nothing: the `cqw` type sizes elsewhere in the view are not inside it. See `SlideVideoLayer` in `src/renderer/src/components/shared/output-view.tsx`.

- **The ratio must come from the rendered page, not from the source.** `DeckSlideVideo.aspectRatio` is `deck_slides.width_px / height_px` — the very image the `<img>` beside it is showing — rather than the OOXML's `p:sldSz`. Deriving it from the source would make the overlay's box and the image's box two independent computations that agree only until a rasterizer setting changes.

- Two alternatives were rejected on purpose: measuring the box in JS (a `ResizeObserver` is exact but creates a second source of truth for a geometry CSS already owns), and an SVG `preserveAspectRatio`/`foreignObject` wrapper (correct geometrically, but it puts a `<video>` inside SVG compositing — the last place this app wants to be, given [`worship-protocol-range-and-video-lifecycle.md`](worship-protocol-range-and-video-lifecycle.md)).

- Related: [`monitor-stage-must-size-by-width-not-flex.md`](monitor-stage-must-size-by-width-not-flex.md) is the outer half of this — how the stage itself gets its size. This entry is about finding the *content* inside that stage.

- **It bit a second time, in `timer-scene.tsx` (2026-09-20).** Its `VERTICAL_ALIGN` map had been
  `pt-[8cqh]` / `pb-[8cqh]` since the time scenes shipped — inside the same `inline-size` root,
  so on a 240 px confidence monitor that gutter resolved against the whole control window
  instead of against the stage. Now `4.5cqw`, which is the same 8 % of the height on a 16:9
  stage and is what `bible-scene.tsx` uses for the verse's own title-safe margin. **The rule
  generalises: no `cqh` anywhere under `OutputView` unless it is inside a private
  `container-type: size` wrapper.**

**Last updated:** 2026-09-20
