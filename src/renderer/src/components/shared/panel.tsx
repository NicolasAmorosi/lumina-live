import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@renderer/lib/utils";
import { Title } from "@renderer/components/ui";

type PanelProps = HTMLAttributes<HTMLDivElement> & { children: ReactNode };

/** The one shared shape behind every panel of the workspace. */
export function Panel({ children, className, ...props }: PanelProps) {
  return (
    <section className={cn("flex h-full min-h-0 flex-col overflow-hidden bg-surface", className)} {...props}>
      {children}
    </section>
  );
}

export function PanelHeader({
  actions,
  title,
}: {
  actions?: ReactNode;
  /** Usually a plain string; the monitors column needs a blinking on-air dot
   *  next to its label, hence ReactNode instead of forcing a second header
   *  primitive that would only differ in that one respect. */
  title: ReactNode;
}) {
  return (
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-y-1 border-b border-border px-2 py-2">
      <Title as="h2">{title}</Title>
      {actions ? <div className="flex min-w-0 flex-wrap items-center gap-1.5">{actions}</div> : null}
    </div>
  );
}

export function PanelBody({ children, className, ...props }: PanelProps) {
  return (
    <div className={cn("min-h-0 flex-1 overflow-y-auto", className)} {...props}>
      {children}
    </div>
  );
}

/** Bottom action strip of a panel (move/remove, add, counters…). */
export function PanelFooter({ children, className, ...props }: PanelProps) {
  return (
    <div
      className={cn("flex shrink-0 flex-wrap items-center gap-1 border-t border-border px-2 py-1.5", className)}
      {...props}
    >
      {children}
    </div>
  );
}
