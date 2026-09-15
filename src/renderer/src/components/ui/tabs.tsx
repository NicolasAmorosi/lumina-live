import type { KeyboardEvent, ReactNode } from "react";
import { cn } from "@renderer/lib/utils";
import { Icon, type IconName } from "./icon";

export type TabItem<T extends string> = { icon?: IconName; label: string; value: T };

export type TabsVariant = "underline" | "folder" | "sidebar";

type TabsProps<T extends string> = {
  className?: string;
  /** Shared with the `TabPanel`s this list controls, so tab and panel can
   *  point at each other (`aria-controls` / `aria-labelledby`). Omit it when
   *  the content isn't rendered as a `tabpanel` at all. */
  idBase?: string;
  onChange: (value: T) => void;
  tabs: readonly TabItem<T>[];
  /** "folder" is the dense, EasyWorship-style resource selector. "sidebar" is
   *  a vertical category list, e.g. Settings' left column. */
  variant?: TabsVariant;
  value: T;
};

/** The two halves of one tab's identity. Kept as functions so the tab and its
 *  panel can never disagree about the string. */
function tabDomId(idBase: string, value: string): string {
  return `${idBase}-tab-${value}`;
}

function panelDomId(idBase: string, value: string): string {
  return `${idBase}-panel-${value}`;
}

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
  underline: "border-primary text-primary-ink",
  folder: "border-border bg-surface text-primary-ink",
  sidebar: "bg-active font-medium text-foreground",
};

const inactiveVariants: Record<TabsVariant, string> = {
  underline: "border-transparent text-subtle hover:text-foreground",
  folder: "border-transparent bg-muted/50 text-subtle hover:bg-hover hover:text-foreground",
  sidebar: "border-transparent text-muted-foreground hover:bg-hover hover:text-foreground",
};

export function Tabs<T extends string>({
  className,
  idBase,
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
    const nextIndex = (index + delta + tabs.length) % tabs.length;
    const next = tabs[nextIndex];
    if (!next) return;
    onChange(next.value);
    // Roving tabindex is only half the contract: selection moves the `0` to
    // the new tab, and focus has to follow it, or the next arrow key is read
    // by a button that is now `tabIndex={-1}` and the operator is stranded
    // one tab behind what is actually selected.
    const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    buttons[nextIndex]?.focus();
  }

  return (
    /* eslint-disable-next-line jsx-a11y/interactive-supports-focus -- The
       tablist is the delegate, not the tab stop: roving tabindex puts the
       single `0` on the selected tab button, and the arrows are caught here
       only because they bubble from it. Making the container focusable would
       add a stop that lands on nothing. */
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
            aria-controls={idBase ? panelDomId(idBase, tab.value) : undefined}
            aria-selected={active}
            className={cn(
              "inline-flex cursor-pointer items-center font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              tabVariants[variant],
              active ? activeVariants[variant] : inactiveVariants[variant],
            )}
            id={idBase ? tabDomId(idBase, tab.value) : undefined}
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

/**
 * The box every `TabPanel` is stacked inside. Positioned, because the panels
 * overlap: a tab that has been visited stays mounted (see `TabPanel`) and the
 * inactive ones sit underneath the active one rather than beside it.
 */
export function TabPanels({ children }: { children: ReactNode }) {
  return <div className="relative flex min-h-0 flex-1 flex-col">{children}</div>;
}

/**
 * One tab's content, inside a `TabPanels`.
 *
 * An inactive panel is hidden with `visibility`, never unmounted and never
 * `display: none`. Both of those destroy the layout box, and with it the
 * scroll offset of everything inside — which for a virtualized grid means
 * coming back to the top of a folder of 600 files, re-measuring, re-reading
 * `deck:statuses` and re-warming from scratch. `visibility: hidden` keeps the
 * box (so scroll position and measured widths survive) while taking the
 * subtree out of the tab order and off the screen.
 */
export function TabPanel({
  active,
  children,
  idBase,
  value,
}: {
  active: boolean;
  children: ReactNode;
  /** Must match the `idBase` given to the controlling `Tabs`. */
  idBase: string;
  value: string;
}) {
  return (
    <div
      aria-hidden={!active || undefined}
      aria-labelledby={tabDomId(idBase, value)}
      className={cn(
        "absolute inset-0 flex min-h-0 flex-col overflow-hidden",
        !active && "invisible pointer-events-none",
      )}
      id={panelDomId(idBase, value)}
      role="tabpanel"
    >
      {children}
    </div>
  );
}
