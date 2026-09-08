import type { LiHTMLAttributes, ReactNode } from "react";
import { cn } from "@renderer/lib/utils";

type ListRowProps = Omit<LiHTMLAttributes<HTMLLIElement>, "children"> & {
  /** On the projector right now — an on-air dot plus a coloured rail. */
  active?: boolean;
  children: ReactNode;
  /** Drop indicator while a drag hovers just above this row. */
  dropBefore?: boolean;
  /** Position number in the gutter, the way EasyWorship numbers a schedule. */
  index?: number;
  leading?: ReactNode;
  selected?: boolean;
  trailing?: ReactNode;
};

/** Selectable row shared by the schedule and the resource lists. */
export function ListRow({
  active = false,
  children,
  className,
  dropBefore = false,
  index,
  leading,
  selected = false,
  trailing,
  ...props
}: ListRowProps) {
  return (
    <li
      aria-current={selected || undefined}
      className={cn(
        "relative flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
        selected ? "bg-active text-foreground" : "hover:bg-hover",
        active && "font-medium",
        dropBefore && "before:absolute before:inset-x-0 before:-top-px before:h-0.5 before:rounded-full before:bg-primary",
        className,
      )}
      {...props}
    >
      {active ? <span className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-on-air" /> : null}
      {index !== undefined ? (
        <span className="w-4 shrink-0 text-right text-xs tabular-nums text-subtle">{index}</span>
      ) : null}
      {leading ? <span className="flex shrink-0 items-center">{leading}</span> : null}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {trailing ? <span className="flex shrink-0 items-center gap-1">{trailing}</span> : null}
    </li>
  );
}
