/**
 * The content grids' measurements, for the callers that have to know them
 * before a tile exists: `VirtualGrid` positions rows against a height it
 * computes itself.
 *
 * They live here, beside `slide-grid.tsx`, for two reasons. One is Fast
 * Refresh — a module exporting both a component and plain values is rejected
 * by it (same reason as `thumb-tile.geometry.ts`). The other is that the
 * centre column and the monitors column render the SAME grid twice, one
 * previewing and one live, and the whole point of that pairing is that the two
 * look identical: numbers copied into both features would drift the first time
 * one of them was tuned.
 *
 * Every value is IMPOSED by what the grids actually render — change one and
 * change the other.
 */

/** `gap-3` on the tiles, in px. */
export const SLIDE_GRID_GAP_PX = 12;

/** A deck always renders two slides across, whatever the panel's width: big
 *  enough to read a hymn's lyrics from the booth. Deliberate layout, not a
 *  consequence of the column being narrow — hence a fixed count rather than a
 *  minimum width. */
export const DECK_GRID_COLUMNS = 2;

/** Minimum verse-tile width, the equivalent of the `minmax(9rem,1fr)` the
 *  verse grid used before it was virtualized. */
export const VERSE_TILE_MIN_WIDTH_PX = 144;
