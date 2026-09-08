import type { ReactNode } from "react";
import { cn } from "@renderer/lib/utils";

type SlideGridProps = {
  children: ReactNode;
  /** "flow" (default) packs as many tiles per row as fit — used by verse and
   *  single-asset grids, which can have dozens of short entries. "fixed-2"
   *  is a deck's own layout: always two columns, so each slide renders large
   *  enough to actually read from across the room. */
  variant?: "flow" | "fixed-2";
};

/** The centre column's grid geometry, shared by deck slides and verse slides
 *  so both columns of tiles line up identically. */
export function SlideGrid({ children, variant = "flow" }: SlideGridProps) {
  return (
    <div
      className={cn(
        "grid content-start gap-3",
        variant === "fixed-2" ? "grid-cols-2" : "grid-cols-[repeat(auto-fill,minmax(9rem,1fr))]",
      )}
    >
      {children}
    </div>
  );
}
