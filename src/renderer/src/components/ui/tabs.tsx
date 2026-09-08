import type { ReactNode } from "react";
import { cn } from "@renderer/lib/utils";
import { Icon, type IconName } from "./icon";

export type TabItem<T extends string> = { icon?: IconName; label: string; value: T };

export type TabsVariant = "underline" | "folder";

type TabsProps<T extends string> = {
  className?: string;
  onChange: (value: T) => void;
  tabs: readonly TabItem<T>[];
  /** "folder" is the dense, EasyWorship-style resource selector. */
  variant?: TabsVariant;
  value: T;
};

const listVariants: Record<TabsVariant, string> = {
  underline: "gap-1 border-b border-border px-2",
  folder: "flex-wrap gap-0.5 border-b border-border px-1 pt-1",
};

const tabVariants: Record<TabsVariant, string> = {
  underline: "gap-1.5 border-b-2 px-3 py-2 text-sm",
  folder: "gap-1 rounded-t-md border border-b-0 px-2 py-1 text-xs",
};

const activeVariants: Record<TabsVariant, string> = {
  underline: "border-primary text-primary",
  folder: "border-border bg-surface text-primary",
};

const inactiveVariants: Record<TabsVariant, string> = {
  underline: "border-transparent text-subtle hover:text-foreground",
  folder: "border-transparent bg-muted/50 text-subtle hover:bg-hover hover:text-foreground",
};

export function Tabs<T extends string>({
  className,
  onChange,
  tabs,
  value,
  variant = "underline",
}: TabsProps<T>) {
  return (
    <div className={cn("flex shrink-0 items-center", listVariants[variant], className)} role="tablist">
      {tabs.map((tab) => {
        const active = tab.value === value;
        return (
          <button
            aria-selected={active}
            className={cn(
              "inline-flex cursor-pointer items-center font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              tabVariants[variant],
              active ? activeVariants[variant] : inactiveVariants[variant],
            )}
            key={tab.value}
            onClick={() => onChange(tab.value)}
            role="tab"
            type="button"
          >
            {tab.icon ? <Icon className="size-3.5" name={tab.icon} /> : null}
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel({ active, children }: { active: boolean; children: ReactNode }) {
  if (!active) return null;
  return <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>;
}
