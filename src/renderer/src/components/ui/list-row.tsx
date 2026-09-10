import type { LiHTMLAttributes, MouseEvent, ReactNode, Ref } from "react";
import { cn } from "@renderer/lib/utils";
import { Icon } from "./icon";

type ListRowProps = Omit<LiHTMLAttributes<HTMLLIElement>, "children"> & {
  /** On the projector right now — an on-air dot plus a coloured rail. */
  active?: boolean;
  children: ReactNode;
  /** Drop indicator while a drag hovers just above this row. */
  dropBefore?: boolean;
  /** Shows the grip icon. By default it's purely visual — the row itself
   *  stays draggable everywhere, this only hints that it can be. Pair with
   *  `onGripMouseDown`/`onGripMouseUp` to make the grip the only place a drag
   *  can start from. */
  grip?: boolean;
  /** Shows the grip but greys it out and drops its handlers — the affordance
   *  stays in place instead of the row jumping around when reordering isn't
   *  available right now (e.g. a filtered list). */
  gripDisabled?: boolean;
  /** Position number in the gutter, the way EasyWorship numbers a schedule. */
  index?: number;
  leading?: ReactNode;
  /** Handle-only drag: the caller arms `draggable` on mousedown here and
   *  disarms it on mouseup/dragend, so a drag can only start from the grip. */
  onGripMouseDown?: ((e: MouseEvent<HTMLSpanElement>) => void) | undefined;
  onGripMouseUp?: ((e: MouseEvent<HTMLSpanElement>) => void) | undefined;
  ref?: Ref<HTMLLIElement>;
  selected?: boolean;
  trailing?: ReactNode;
};

/** Selectable row shared by the schedule and the resource lists. */
export function ListRow({
  active = false,
  children,
  className,
  dropBefore = false,
  grip = false,
  gripDisabled = false,
  index,
  leading,
  onGripMouseDown,
  onGripMouseUp,
  ref,
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
      ref={ref}
      {...props}
    >
      {active ? <span className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-on-air" /> : null}
      {grip ? (
        <span
          className={cn(
            "flex shrink-0 items-center",
            gripDisabled ? "cursor-not-allowed text-subtle opacity-40" : "cursor-grab text-subtle",
          )}
          onMouseDown={gripDisabled ? undefined : onGripMouseDown}
          onMouseUp={gripDisabled ? undefined : onGripMouseUp}
        >
          <Icon name="grip" />
        </span>
      ) : null}
      {index !== undefined ? (
        <span className="w-4 shrink-0 text-right text-xs tabular-nums text-subtle">{index}</span>
      ) : null}
      {leading ? <span className="flex shrink-0 items-center">{leading}</span> : null}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {trailing ? <span className="flex shrink-0 items-center gap-1">{trailing}</span> : null}
    </li>
  );
}
