import type { MouseEvent, ReactNode } from "react";
import { cn } from "@renderer/lib/utils";
import { Icon } from "./icon";
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
 *  description) on the left, its control(s) on the right, never wrapping.
 *
 *  `label` and `description` are nodes rather than strings because this row is
 *  also what a LIST of things looks like in Ajustes — the installed bibles —
 *  and one of those rows swaps its name for an `<Input>` while it is being
 *  renamed. Keeping that inside the same primitive is what makes a list row
 *  and a settings row exactly the same height, which is the whole reason the
 *  list is built from this and not from the denser `ListRow` the resource
 *  panels use.
 *
 *  The grip and drop-indicator props are spelled exactly like `ListRow`'s, and
 *  mean exactly the same thing: a reorderable list in Ajustes and one in a
 *  resource panel are the same interaction at two densities, and two spellings
 *  of it is how the two start behaving differently. */
export function FieldRow({
  children,
  description,
  dropBefore = false,
  grip = false,
  gripDisabled = false,
  label,
  leading,
  onGripMouseDown,
  onGripMouseUp,
}: {
  children: ReactNode;
  description?: ReactNode;
  /** Drop indicator while a drag hovers just above this row. */
  dropBefore?: boolean;
  /** Shows the grip icon. Handle-only drag: pair it with
   *  `onGripMouseDown`/`onGripMouseUp`, which is what arms `draggable` on the
   *  element that owns this row — native HTML5 drag has no handle concept. */
  grip?: boolean;
  /** Shows the grip but greys it out and drops its handlers, so the row does
   *  not change width when reordering is momentarily unavailable. */
  gripDisabled?: boolean;
  label: ReactNode;
  /** Sits before the label — an icon badge for a row that names a THING (a
   *  bible, a file) rather than a preference. */
  leading?: ReactNode;
  onGripMouseDown?: ((e: MouseEvent<HTMLSpanElement>) => void) | undefined;
  onGripMouseUp?: ((e: MouseEvent<HTMLSpanElement>) => void) | undefined;
}) {
  return (
    <div
      className={cn(
        "relative flex flex-nowrap items-center justify-between gap-6 px-4 py-3",
        dropBefore &&
          "before:absolute before:inset-x-0 before:-top-px before:h-0.5 before:rounded-full before:bg-primary",
      )}
    >
      {/* Grip and `leading` share one box on a `gap-2` of their own: the row's
          own `gap-6` is the distance between the NAME and its controls, and
          applied between a handle and the star beside it it reads as two
          unrelated columns. */}
      {grip || leading ? (
        <span className="flex shrink-0 items-center gap-2">
          {grip ? (
            <span
              className={cn(
                "flex items-center",
                gripDisabled ? "cursor-not-allowed text-subtle opacity-40" : "cursor-grab text-subtle",
              )}
              onMouseDown={gripDisabled ? undefined : onGripMouseDown}
              onMouseUp={gripDisabled ? undefined : onGripMouseUp}
            >
              <Icon name="grip" />
            </span>
          ) : null}
          {leading}
        </span>
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-sm font-medium text-foreground">{label}</span>
        {description ? <span className="text-xs text-muted-foreground">{description}</span> : null}
      </div>
      <div className="flex shrink-0 flex-nowrap items-center gap-2">{children}</div>
    </div>
  );
}
