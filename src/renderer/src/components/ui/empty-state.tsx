import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@renderer/lib/utils";
import { Icon, type IconName } from "./icon";

type EmptyStateProps = HTMLAttributes<HTMLDivElement> & {
  action?: ReactNode;
  description?: string;
  icon?: IconName;
  title: string;
};

export function EmptyState({ action, className, description, icon, title, ...props }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border p-6 text-center",
        className,
      )}
      {...props}
    >
      {icon ? <Icon className="size-6 text-subtle" name={icon} /> : null}
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description ? <p className="text-xs text-subtle">{description}</p> : null}
      {action}
    </div>
  );
}
