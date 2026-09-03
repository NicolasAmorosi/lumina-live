import type { ReactNode } from "react";
import { cn } from "@renderer/lib/utils";
import { Icon, type IconName } from "./icon";

export type TabItem<T extends string> = { icon?: IconName; label: string; value: T };

type TabsProps<T extends string> = {
  className?: string;
  onChange: (value: T) => void;
  tabs: readonly TabItem<T>[];
  value: T;
};

export function Tabs<T extends string>({ className, onChange, tabs, value }: TabsProps<T>) {
  return (
    <div className={cn("flex items-center gap-1 border-b border-border px-2", className)} role="tablist">
      {tabs.map((tab) => {
        const active = tab.value === value;
        return (
          <button
            aria-selected={active}
            className={cn(
              "inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "border-primary text-primary"
                : "border-transparent text-subtle hover:text-foreground",
            )}
            key={tab.value}
            onClick={() => onChange(tab.value)}
            role="tab"
            type="button"
          >
            {tab.icon ? <Icon name={tab.icon} /> : null}
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel({ active, children }: { active: boolean; children: ReactNode }) {
  if (!active) return null;
  return <div className="flex-1 overflow-hidden">{children}</div>;
}
