import type { ReactNode } from "react";
import { cn } from "@renderer/lib/utils";
import { Title } from "./title";

/** A titled group of related fields, rendered as a bordered, divider-lined
 *  group of rows — the same lines-not-shadows container the rest of the system
 *  uses (`Panel`, the theme toggle, `deck-slides`), not the elevated `Card`
 *  primitive. Add a field to an existing group, or start a new group; never a
 *  flat list of rows.
 *
 *  Lives here rather than in `pages/settings/` because two features use it now
 *  — Ajustes and the «Escenas» editor — which is exactly the second use the
 *  reuse rule in `CLAUDE.md` promotes on. */
export function FieldGroup({ children, className, title }: { children: ReactNode; className?: string; title: string }) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <Title as="h2">{title}</Title>
      <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
        {children}
      </div>
    </div>
  );
}

/** One field per row inside a `FieldGroup`: label (+ optional helper
 *  description) on the left, its control(s) on the right, never wrapping. */
export function FieldRow({
  children,
  description,
  label,
}: {
  children: ReactNode;
  description?: string;
  label: string;
}) {
  return (
    <div className="flex flex-nowrap items-center justify-between gap-6 px-4 py-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm font-medium text-foreground">{label}</span>
        {description ? <span className="text-xs text-muted-foreground">{description}</span> : null}
      </div>
      <div className="flex shrink-0 flex-nowrap items-center gap-2">{children}</div>
    </div>
  );
}
