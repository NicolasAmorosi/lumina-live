import type { HTMLAttributes } from "react";
import markUrl from "@renderer/assets/brand/lumina-live-mark.svg";
import { cn } from "@renderer/lib/utils";

/**
 * The Lumina Live mark: the identity sheet's flame on its navy tile. An asset
 * and not markup, because its colours are the LOGO's, not the theme's — the
 * one place a hex belongs is the artwork itself. On the dark theme the tile is
 * the toolbar's own colour, so it carries an edge (`brand-edge`) or only the
 * flame would show; an inset outline, because it paints over the image and
 * follows whatever radius the caller gives it (default: the artwork's 7.3 %).
 *
 * Decorative (`alt=""`): wherever it appears, the product name is also on
 * screen or in the window title.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <img
      alt=""
      className={cn(
        "size-7 shrink-0 rounded-[7.3%] outline-1 -outline-offset-1 outline-brand-edge select-none",
        className,
      )}
      draggable={false}
      src={markUrl}
    />
  );
}

/** «Lumina Live» set the way the sheet sets it: Noto Sans ExtraCondensed
 *  ExtraBold, two lines 0.858 em apart, "Live" in the flame's core colour. */
export function Wordmark({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "inline-flex flex-col font-stretch-extra-condensed leading-[0.858] font-extrabold text-foreground",
        className,
      )}
      {...props}
    >
      <span>Lumina</span>
      <span className="text-brand-live">Live</span>
    </span>
  );
}
