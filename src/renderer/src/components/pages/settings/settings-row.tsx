import type { ReactNode } from "react";
import { Title } from "@renderer/components/ui";

/** A titled group of related settings, rendered as a bordered, divider-lined
 *  group of rows — the same lines-not-shadows container the rest of the
 *  system uses (`Panel`, the theme toggle, `deck-slides`), not the elevated
 *  `Card` primitive. Add a new setting to an existing group, or start a new
 *  group; never a flat list of rows. */
export function SettingsGroup({ children, title }: { children: ReactNode; title: string }) {
  return (
    <div className="flex flex-col gap-2">
      <Title as="h2">{title}</Title>
      <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
        {children}
      </div>
    </div>
  );
}

/** One setting per row inside a `SettingsGroup`: label (+ optional helper
 *  description) on the left, its control(s) on the right, never wrapping. */
export function SettingsRow({
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
