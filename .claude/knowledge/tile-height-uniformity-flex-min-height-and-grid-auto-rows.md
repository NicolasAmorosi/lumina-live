## A `<button>` tile stops filling its cell the moment it is not the grid item itself — and its `aspect-video` does not survive being a flex item either
**Area:** ui / renderer
**Trigger:** tiles in a grid coming out different sizes depending on what is inside them (width OR height); tiles overlapping each other or as narrow as their own label text; rows of a virtualized grid drifting out of alignment further down the list; touching `components/ui/thumb-tile.tsx`, `components/ui/thumb-tile.geometry.ts` or `components/ui/virtual-grid.tsx`.

- **Believed:** `<span className="flex aspect-video w-full …">` inside a `flex flex-col` tile
  gives every tile the same 16:9 media box, whatever image lands in it. And a CSS grid whose
  rows are all the same kind of item will lay those rows out at the same height.

  **Both are false**, and together they made every library tile a different size once real
  media (rather than three test files) was in the grid.

- **Measured** on 2026-09-11 by rebuilding the app's real compiled CSS, replicating
  `ThumbTile`'s exact markup in a page, and reading `getBoundingClientRect()` in a hidden
  `BrowserWindow`. Ten tiles that should all have been 93 px:

  | tile content | height |
  |---|---|
  | 3840×2160 landscape | 99.28 |
  | 600×2400 very tall | 93.78 |
  | 40×40 tiny | 63.88 |
  | no `src` yet (still loading) | 89.88 |
  | broken `src` | 64.64 |
  | icon fallback | 70.75 |
  | "missing" badge overlay | 103.88 |

  Two independent causes:

  1. **A flex item's automatic minimum size is content-based.** `min-height: auto` on the media
     span lets the `<img>`'s own intrinsic size override the height `aspect-ratio` computed, in
     both directions — a huge image pushes the box taller, a 40×40 one lets it collapse. The
     fix is `min-h-0` (so the aspect ratio wins) plus `grow` (so the box fills the height it is
     given) plus `h-full` on the tile itself (so it fills its row at all). `min-h-0` here is the
     height analogue of the `min-w-0` trap in
     [grid-items-need-min-w-0-to-let-truncate-work.md](grid-items-need-min-w-0-to-let-truncate-work.md).
  2. **`VirtualGrid` positions a *block* of rows, not each row.** With `gridAutoRows: auto` the
     rows inside that block size themselves to their contents, so only the first row lands where
     the virtual geometry says and every row below it drifts — measured 18 px of accumulated
     drift over three rows, and the spacer's declared height no longer matched the real content
     height. `gridAutoRows: <rowHeight - gap>px` is mandatory, not cosmetic.

- **A third, quieter defect fell out of the same measurement:** `THUMB_TILE_LABEL_PX = 24` was a
  *guess* at what `text-xs` plus `py-1` would come out to, and `VirtualGrid` positions rows
  against it. The label is now given that height explicitly (`h-6`/`leading-6`). A constant a
  layout is computed from has to be enforced by the CSS, not estimated from it.

- **Consequence.** Any tile primitive that will live in a fixed-height row needs all three of
  `h-full` / `min-h-0` / `grow`, and any constant a grid computes offsets from must be pinned in
  the markup. Verified after the fix: all ten cases at exactly 93 px tile and 67 px media box,
  spacer height matching content height, and `SlideGrid` (auto-height rows, verse and deck-slide
  tiles) measurably unchanged before and after.

  Beware when testing this: Tailwind only emits classes that appear in the source, so a class
  tried out **only** inside a scratch harness silently does nothing and the harness reports a
  false pass. `h-6` measured 0 px until it was used in `thumb-tile.tsx` for real and the CSS was
  rebuilt.

### The width half of the same bug, found the next day (2026-09-11, later)

The height fixes above shipped and the grid still looked wrong: the user reported that "todas
las miniaturas tienen formatos incorrectos", videos and images "más anchas", unconverted decks
"como una sola línea".

- **Believed:** a `<button className="flex h-full w-…">` fills the box its container gives it,
  so `h-full` was the only thing missing when `ThumbTile` stopped being laid out directly by a
  CSS grid.

  **False.** A `<button>` is sized **shrink-to-fit** by the UA — `display: flex` does not change
  that. While the tile *was* the grid item, `justify-items: stretch` filled its cell for free
  and hid it completely. Wrapping it in `VirtualGrid`'s `role="listitem"` div (which now carries
  the grid cell) left the button sized by its own content: **the width of its label text**.

- **Measured** on the real running app over CDP (`Runtime.evaluate` +
  `Page.captureScreenshot` against `--remote-debugging-port`, control window), in a column grid
  whose tracks were 119.39 px wide:

  | tile | button width |
  |---|---|
  | deck named "001" | **34.59** |
  | "Milano Marathon (FINAL)…" | **161.47** |
  | "Noisestorm - Crab Rave" | **266.78** |
  | "Passi di speranza_01…" | **217.44** |

  Tiles overlapped each other; a 35×92 box with a 16:9 media area inside reads as a vertical
  sliver, a 267-wide one as a stretched banner. The fix is `w-full` alongside `h-full` in
  `ThumbTile`'s base classes.

- **Why the earlier measurement missed it:** the height work was verified against a *replica* of
  `ThumbTile`'s markup in a scratch page — and in that replica the tile was a direct grid child,
  so it stretched. **Measure the app, not a reproduction of it**: the CDP route above costs
  about as much to set up (`electron-vite dev -- --remote-debugging-port=9222`, plus
  `--user-data-dir` pointing at a copy of `userData` so it doesn't fight the single-instance
  lock or touch the real library) and cannot be wrong about the component tree.
  See also [occluded-electron-window-has-no-rendering-lifecycle.md](occluded-electron-window-has-no-rendering-lifecycle.md),
  which is the trap waiting on the other side of that setup.

- **Two smaller corrections from the same pass**, both now in
  `components/ui/thumb-tile.geometry.ts`:
  - `itemHeight` ignored the tile's 1 px border, so the media box was ~2 px short of its own
    16:9. `thumbTileHeight()` derives the ratio from the tile's *content* width.
  - `VirtualGrid` kept a width measured **before** the scroll ancestor grew a scrollbar (627
    instead of 621): the grid's own height decides whether `PanelBody` scrolls, that scrollbar
    changes the grid's width, and Chrome resolves such `ResizeObserver` loops by *dropping*
    notifications. `recomputeWindow()` now re-reads `clientWidth` on every recompute, and the
    grid renders nothing at all until it has a real width — the old `columnWidth = minItemWidth`
    fallback painted one full-width column of tiles sized for a 112 px one.

**Last updated:** 2026-09-11
