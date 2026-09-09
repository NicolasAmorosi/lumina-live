import type { KeyboardEvent, ReactNode } from "react";
import { cn } from "@renderer/lib/utils";
import { Icon, type IconName } from "./icon";

export type TabItem<T extends string> = { icon?: IconName; label: string; value: T };

export type TabsVariant = "underline" | "folder" | "sidebar";

type TabsProps<T extends string> = {
  className?: string;
  onChange: (value: T) => void;
  tabs: readonly TabItem<T>[];
  /** "folder" is the dense, EasyWorship-style resource selector. "sidebar" is
   *  a vertical category list, e.g. Settings' left column. */
  variant?: TabsVariant;
  value: T;
};

const isVertical: Record<TabsVariant, boolean> = {
  underline: false,
  folder: false,
  sidebar: true,
};

const listVariants: Record<TabsVariant, string> = {
  underline: "flex items-center gap-1 border-b border-border px-2",
  folder: "flex items-center gap-0.5 border-b border-border px-1 pt-1",
  sidebar: "flex w-56 shrink-0 flex-col items-stretch gap-1 overflow-y-auto border-r border-border p-2",
};

const tabVariants: Record<TabsVariant, string> = {
  underline: "gap-1.5 border-b-2 px-3 py-2 text-sm",
  // flex-1 + justify-center: every tab claims the same share of the row
  // regardless of its label's length, so the five resource tabs always fill
  // the whole width instead of leaving dead space after short labels.
  folder: "min-w-0 flex-1 justify-center gap-1 truncate rounded-t-md border border-b-0 px-2 py-1 text-xs",
  sidebar: "w-full justify-start gap-2 rounded-lg px-3 py-2 text-sm",
};

const activeVariants: Record<TabsVariant, string> = {
  underline: "border-primary text-primary",
  folder: "border-border bg-surface text-primary",
  sidebar: "bg-active font-medium text-foreground",
};

const inactiveVariants: Record<TabsVariant, string> = {
  underline: "border-transparent text-subtle hover:text-foreground",
  folder: "border-transparent bg-muted/50 text-subtle hover:bg-hover hover:text-foreground",
  sidebar: "border-transparent text-muted-foreground hover:bg-hover hover:text-foreground",
};

export function Tabs<T extends string>({
  className,
  onChange,
  tabs,
  value,
  variant = "underline",
}: TabsProps<T>) {
  const vertical = isVertical[variant];

  // Roving arrow-key navigation, the standard `tablist` keyboard contract:
  // Left/Right for a horizontal list, Up/Down for a vertical one.
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const nextKey = vertical ? "ArrowDown" : "ArrowRight";
    const prevKey = vertical ? "ArrowUp" : "ArrowLeft";
    if (event.key !== nextKey && event.key !== prevKey) return;
    event.preventDefault();
    const index = tabs.findIndex((tab) => tab.value === value);
    const delta = event.key === nextKey ? 1 : -1;
    const next = tabs[(index + delta + tabs.length) % tabs.length];
    if (next) onChange(next.value);
  }

  return (
    <div
      aria-orientation={vertical ? "vertical" : "horizontal"}
      className={cn(listVariants[variant], className)}
      onKeyDown={onKeyDown}
      role="tablist"
    >
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
            tabIndex={active ? 0 : -1}
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
