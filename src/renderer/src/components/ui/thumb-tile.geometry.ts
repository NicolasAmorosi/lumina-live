/**
 * A tile's measurements, for the one caller that needs to know them before the
 * tile exists: a virtualized grid positions rows against a height it has to
 * compute itself (`VirtualGrid`'s `itemHeight`).
 *
 * It lives beside `thumb-tile.tsx` rather than inside it for a dev-loop
 * reason: a module that exports both a component and a plain function is
 * rejected by React Fast Refresh ("export is incompatible"), which turns every
 * edit to the tile into a full-app HMR invalidation.
 *
 * Every number here is IMPOSED by `thumb-tile.tsx`'s classes, never estimated
 * from them — change one and change the other. That is not a style preference:
 * a grid that positions rows against an estimate is off by that estimate's
 * error on every row after the first.
 */

/** The label row's height: `h-6`/`leading-6` on the tile's label span. */
export const THUMB_TILE_LABEL_PX = 24;

/** The tile's own `border`, top + bottom. The media area's `aspect-video`
 *  applies to its content box, so a height derived from the column width
 *  without this is off by exactly these two pixels. */
export const THUMB_TILE_BORDER_PX = 2;

/**
 * Total height of a tile in a column `columnWidth` px wide: a 16:9 media area
 * over the tile's content width, plus the label row, plus the border.
 */
export function thumbTileHeight(columnWidth: number, opts?: { label?: boolean }): number {
  const mediaHeight = Math.round(((columnWidth - THUMB_TILE_BORDER_PX) * 9) / 16);
  return mediaHeight + THUMB_TILE_BORDER_PX + (opts?.label === false ? 0 : THUMB_TILE_LABEL_PX);
}
