import type { ReactNode } from "react";
import { cn } from "@renderer/lib/utils";

type TooltipProps = {
  children: ReactNode;
  className?: string;
  content: ReactNode;
};

/**
 * Pure-CSS hover/focus tooltip — no portal, no library. `content` sits
 * absolutely positioned off the trigger and only becomes visible (and
 * hit-testable) on `:hover`/`:focus-within`, so it never affects layout or
 * steals clicks while hidden. Anchored to the trigger's right edge so it
 * stays on-screen when the trigger itself sits at a panel's right end.
 */
export function Tooltip({ children, className, content }: TooltipProps) {
  return (
    <span className={cn("group relative inline-flex", className)}>
      {children}
      <span
        className="pointer-events-none absolute top-full right-0 z-10 mt-1.5 w-64 rounded-lg border border-border bg-card p-2 text-xs text-foreground opacity-0 shadow-raised transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
        role="tooltip"
      >
        {content}
      </span>
    </span>
  );
}
