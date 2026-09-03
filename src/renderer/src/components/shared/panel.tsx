import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@renderer/lib/utils";
import { Title } from "@renderer/components/ui";

type PanelProps = HTMLAttributes<HTMLDivElement> & { children: ReactNode };

/** The one shared shape behind the app's three panels (playlist+library, preview+bible, live). */
export function Panel({ children, className, ...props }: PanelProps) {
  return (
    <section className={cn("flex h-full min-h-0 flex-col bg-surface", className)} {...props}>
      {children}
    </section>
  );
}

export function PanelHeader({
  actions,
  title,
}: {
  actions?: ReactNode;
  title: string;
}) {
  return (
    <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2.5">
      <Title as="h2">{title}</Title>
      {actions ? <div className="flex items-center gap-1.5">{actions}</div> : null}
    </div>
  );
}

export function PanelBody({ children, className, ...props }: PanelProps) {
  return (
    <div className={cn("flex-1 overflow-y-auto", className)} {...props}>
      {children}
    </div>
  );
}
