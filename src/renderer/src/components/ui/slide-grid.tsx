import type { ReactNode } from "react";

/**
 * The plain, un-virtualized content grid: one row of tiles that can never grow
 * — the single scheduled verse, a text item, a lone asset.
 *
 * Anything that can hold a passage or a deck (hundreds of tiles, mounted twice
 * over because the preview and live columns show the same content) goes
 * through `VirtualGrid` instead, with the geometry in
 * `slide-grid.geometry.ts`. That is also where a deck's two-column layout
 * lives now; this grid had a `fixed-2` variant for it, and keeping a second
 * definition of the same layout is how the two columns stop matching.
 */
export function SlideGrid({ children }: { children: ReactNode }) {
  return <div className="grid content-start gap-3 grid-cols-[repeat(auto-fill,minmax(9rem,1fr))]">{children}</div>;
}
