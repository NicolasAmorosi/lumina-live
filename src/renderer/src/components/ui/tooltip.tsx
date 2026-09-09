import type { ReactNode } from "react";
import { cn } from "@renderer/lib/utils";

type TooltipProps = {
  /** Which edge the bubble hangs off of horizontally — "end" (default) keeps
   *  it on-screen for a trigger near a panel's right end, "start" for one
   *  near the left end. Every panel here (`Panel`, `shared/panel.tsx`) clips
   *  overflow, so picking the wrong side renders the bubble past the clip
   *  and it never becomes visible. */
  align?: "start" | "end";
  children: ReactNode;
  className?: string;
  content: ReactNode;
  /** Which side of the trigger the bubble opens toward — "bottom" (default)
   *  for a trigger near a panel's top, "top" for one near a panel's bottom
   *  (a `PanelFooter` button), for the same clipping reason as `align`. */
  placement?: "top" | "bottom";
};

/**
 * Pure-CSS hover/focus tooltip — no portal, no library. `content` sits
 * absolutely positioned off the trigger and only becomes visible (and
 * hit-testable) on `:hover`/`:focus-visible`, so it never affects layout or
 * steals clicks while hidden.
 *
 * Uses `focus-visible` rather than `focus-within`: a `<button>` keeps focus
 * after a mouse click (not just after Tab), so `focus-within` left the
 * bubble stuck open post-click until the user focused something else.
 * `focus-visible` only engages for keyboard focus, so Tab navigation still
 * reveals the tooltip while a click dismisses it immediately.
 */
export function Tooltip({ align = "end", children, className, content, placement = "bottom" }: TooltipProps) {
  return (
    <span className={cn("group relative inline-flex", className)}>
      {children}
      <span
        className={cn(
          "pointer-events-none absolute z-10 w-64 rounded-lg border border-border bg-card p-2 text-xs text-foreground opacity-0 shadow-raised transition-opacity group-hover:opacity-100 group-has-[:focus-visible]:opacity-100",
          placement === "top" ? "bottom-full mb-1.5" : "top-full mt-1.5",
          align === "start" ? "left-0" : "right-0",
        )}
        role="tooltip"
      >
        {content}
      </span>
    </span>
  );
}
