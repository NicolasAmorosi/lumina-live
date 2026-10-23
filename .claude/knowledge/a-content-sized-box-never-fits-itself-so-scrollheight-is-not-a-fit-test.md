## A content-sized box never "fits itself", so `scrollHeight > clientHeight` is not a fit test — a sub-1.36 `line-height` made it permanently true and killed every slider in «Verses»
**Area:** renderer / ui
**Trigger:** the verse auto-fit (`useFittedTextSize` / `measureFittedSize` in
`src/renderer/src/components/shared/bible-scene.tsx`), or any new "shrink until it fits" search;
also the symptom "I move the slider and nothing on the stage changes".

- **Believed** — and written into the code's own comment — that `max-h-full` + `overflow-hidden`
  on the text block "is what gives `clientHeight` a ceiling to compare `scrollHeight` against — a
  box that is free to grow always fits". **False in the half that matters.** The block is capped
  by `max-height`, so it is *content-sized* until it reaches the cap. Below the cap
  `clientHeight` **is** the content height, and `scrollHeight > clientHeight` no longer asks "too
  tall for the stage" — it asks "is any ink outside its own line boxes", which is a completely
  different question and one the operator can make permanently true.

- **What makes it permanently true: `line-height` below the font's content area.** Noto Sans is
  ascent 1.069 + descent 0.293 = **1.362 em**, so any `line-height` under ~1.36 gives a negative
  half-leading and the glyphs spill out of their own line boxes at *every* font size. The app's
  default is `1.375` — barely above the threshold, which is why this was invisible until
  «Verses» shipped a leading slider starting at `0.8`.

  Measured on 2026-09-21 in the real app over CDP (block `clientHeight` vs `scrollHeight`, short
  verse, `maxWidthCqw: 100`, stage 448×252 CSS px):

  ```
  line-height 0.8  → 1.5cqw: 18 vs 20   3.5: 25 vs 27   6: 34 vs 36   12: 56 vs 58   fits: never
  line-height 1.0  → 1.5cqw: 21 vs 22   3.5: 30 vs 31   6: 41 vs 42   12: 68 vs 69   fits: never
  line-height 1.2  → 1.5cqw: 24 vs 24   3.5: 35 vs 35   6: 48 vs 49   12: 81 vs 81   fits: not at 6
  line-height 1.3+ → fits at every size
  ```

  So `fits()` returned `false` for the ceiling **and for all seven probes of the binary search**,
  which converges on `low = min` — the verse silently collapsed to `autoFit.minSizeCqw` and stayed
  there. The «Size» slider then moved from 1 to 12 with the projected text frozen at 1.5 cqw:
  four sliders that all *did* write their value to SQLite and all *looked* dead. That is what the
  bug report "some numbers make the change not work" actually was.

- **The `1.2 / 6 cqw` row is a second, independent cause: `clientHeight` and `scrollHeight` are
  integers rounded off a fractional layout.** A box that fills its space exactly can report one
  pixel too many. A fit test with no tolerance turns that one pixel into the whole verse, so the
  failure is *intermittent across values* — the shape that makes a report read as "some numbers
  work and some don't".

- **Consequence — measure against the SPACE, never against the box's own overflow.**
  `measureFittedSize` now takes the stage and compares `block.scrollHeight` to
  `stage.clientHeight − paddingTop − paddingBottom` (`max-h-full` resolved into a number, read
  once per search since no font size can change it), plus `FIT_TOLERANCE_PX = 1`. The *width* leg
  stays `scrollWidth <= clientWidth`, and correctly so: the block's width is pinned at
  `maxWidthCqw`, so there the comparison really does mean "a word is wider than the column".
  Verified after the fix, same worst case (`line-height 0.8`, 12 cqw): short verse renders at
  `12cqw` (58 px of 211.7 available), long verse shrinks to `8.23cqw` (192 px, against 402 px
  unshrunk), auto-fit off → `12cqw`.

- **`overflow-hidden` on the block stays**, but it is now only the guard that keeps a verse
  sized past the frame from painting over its edge — it is no longer part of the measurement.
  Whatever ink a sub-1.36 leading puts outside the box it does clip, and at these leadings that
  clip lands above the cap height: checked at 0.8 / 12 cqw and no glyph is visibly cut.

- **jsdom cannot reproduce any of this, and neither can the test suite.** jsdom implements no
  layout (`scrollHeight` is 0) *and* no `<input type="range">` value sanitization — a range with
  `min=0.8 step=0.01` happily reports `value === "1.375"` there, where Chromium snaps the thumb to
  `1.38`. The first hour went into a snapping hypothesis that only real Chromium could have
  falsified. Anything that reads layout has to be driven against the running app; see
  [one-cdp-evaluate-is-one-react-commit-so-n-clicks-measure-one.md](one-cdp-evaluate-is-one-react-commit-so-n-clicks-measure-one.md)
  and
  [occluded-electron-window-has-no-rendering-lifecycle.md](occluded-electron-window-has-no-rendering-lifecycle.md).

- **Side note, deliberately left alone:** `1.375` is not on the leading slider's own grid
  (`min 0.8`, `step 0.01`), so out of the box the store holds `1.375` while the thumb and the
  readout say `1.38`. That is the documented behaviour of these sliders — they cap and snap the
  *thumb*, never rewriting a stored value they did not touch — and the one drag position it costs
  is the one already showing the same number.

**Last updated:** 2026-09-21
