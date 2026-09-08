import type { ReactNode } from "react";
import { cn } from "@renderer/lib/utils";

export type MonitorTone = "onAir" | "preview" | "idle";

type MonitorProps = {
  /** The stage content — an OutputView, normally. */
  children?: ReactNode;
  className?: string;
  /** Shown on the black stage when there is nothing to render. Kept here (and
   *  not as a caller-side EmptyState) because the stage is always black in
   *  both themes, so its text has to be light in both. */
  empty?: string;
  /** Rendered under the stage — transport buttons, "EN VIVO". */
  footer?: ReactNode;
  label: string;
  /** Short right-aligned text in the header (slide counter, "sin señal"…). */
  status?: string;
  tone?: MonitorTone;
};

const frameTone: Record<MonitorTone, string> = {
  onAir: "border-on-air",
  preview: "border-success",
  idle: "border-border",
};

const headerTone: Record<MonitorTone, string> = {
  onAir: "bg-on-air text-on-air-foreground",
  preview: "bg-success text-success-foreground",
  idle: "bg-muted text-muted-foreground",
};

/**
 * The EasyWorship-style monitor: a labelled, colour-coded 16:9 stage.
 * ONE primitive for both the live and the preview pane — the only difference
 * between them is `tone`, `label` and what gets rendered inside, which is
 * exactly what keeps the two panes visually identical by construction.
 */
export function Monitor({
  children,
  className,
  empty,
  footer,
  label,
  status,
  tone = "idle",
}: MonitorProps) {
  return (
    <section className={cn("flex min-h-0 flex-col overflow-hidden rounded-xl border-2 bg-surface shadow-surface", frameTone[tone], className)}>
      <header className={cn("flex shrink-0 items-center justify-between gap-2 px-2 py-1", headerTone[tone])}>
        <span className="flex items-center gap-1.5 text-xs font-semibold tracking-wide uppercase">
          {tone === "onAir" ? <span className="size-2 rounded-full bg-current" /> : null}
          {label}
        </span>
        {status ? <span className="truncate text-xs font-medium opacity-90">{status}</span> : null}
      </header>
      {/* The 16:9 stage is a fixed-ratio box centred in whatever space is left,
          never a flex-fill area — otherwise its on-screen size would depend
          on whether a footer is present or how tall the current content is
          (a verse's text, a deck's transport controls…), which is exactly the
          "the box isn't a fixed size" bug this guards against. */}
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-1">
        <div className="aspect-video max-h-full w-full max-w-full overflow-hidden bg-black">
          <div className="flex size-full items-center justify-center">
            {children ?? (
              <span className="px-4 text-center text-xs text-white/60">{empty}</span>
            )}
          </div>
        </div>
      </div>
      {footer ? <div className="shrink-0 border-t border-border bg-surface">{footer}</div> : null}
    </section>
  );
}
