import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@renderer/lib/utils";
import { Icon, type IconName } from "./icon";

type EmptyStateProps = HTMLAttributes<HTMLDivElement> & {
  action?: ReactNode;
  description?: string;
  icon?: IconName;
  title: string;
  /** "danger" keeps the same dashed-box shape but marks it as an error
   *  state (e.g. a selected item whose file is gone) instead of a neutral
   *  "nothing here yet" placeholder. */
  tone?: "neutral" | "danger";
};

/** Fills its container and centers the box both ways. Positioned absolutely
 *  against the nearest positioned ancestor — always a `PanelBody`, which is
 *  `relative` for exactly this reason — instead of relying on flex-grow,
 *  which doesn't reach through a CSS Grid row (`SlidesPanel`'s layout) the
 *  way it does through a flex column. */
export function EmptyState({ action, className, description, icon, title, tone = "neutral", ...props }: EmptyStateProps) {
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <div
        className={cn(
          "flex max-w-md flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-6 text-center",
          tone === "danger" ? "border-danger/40" : "border-border",
          className,
        )}
        {...props}
      >
        {icon ? <Icon className={cn("size-6", tone === "danger" ? "text-danger" : "text-subtle")} name={icon} /> : null}
        <p className={cn("text-sm font-medium", tone === "danger" ? "text-danger" : "text-foreground")}>{title}</p>
        {description ? <p className="text-xs text-subtle">{description}</p> : null}
        {action}
      </div>
    </div>
  );
}
