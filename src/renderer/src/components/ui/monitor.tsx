import type { ReactNode } from "react";
import { cn } from "@renderer/lib/utils";

type MonitorProps = {
  /** The stage content — an OutputView, normally. */
  children?: ReactNode;
  className?: string;
  /** Shown on the black stage when there is nothing to render. Kept here (and
   *  not as a caller-side EmptyState) because the stage is always black in
   *  both themes, so its text has to be light in both. */
  empty?: string;
};

/**
 * The EasyWorship-style monitor: a bare 16:9 stage, no frame of its own — the
 * ONE primitive for both the live and the preview pane, which is exactly what
 * keeps the two panes visually identical by construction. Which one is which
 * (label, on-air state) lives in each column's own header, not here.
 */
export function Monitor({ children, className, empty }: MonitorProps) {
  return (
    <div className={cn("flex justify-center overflow-hidden p-3 pb-0", className)}>
      {/* The 16:9 stage's height always follows its width, never the leftover
          space in whatever grid row it lands in — a sibling (deck transport,
          a media track row) taking more or less height below it must never
          change how big this box renders. That decoupling is what keeps the
          LIVE and PREVIEW monitors pixel-identical, and keeps a PPT deck's
          transport controls from squeezing the live rectangle smaller than a
          plain video's. */}
      <div className="aspect-video w-full max-w-full overflow-hidden rounded-md bg-black">
        <div className="flex size-full items-center justify-center">
          {children ?? (
            <span className="px-4 text-center text-xs text-white/60">{empty}</span>
          )}
        </div>
      </div>
    </div>
  );
}
