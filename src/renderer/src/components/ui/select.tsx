import type { ButtonHTMLAttributes, KeyboardEvent as ReactKeyboardEvent } from "react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@renderer/lib/utils";
import { Icon } from "./icon";

export type SelectOption = { disabled?: boolean; label: string; value: string };

type SelectProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onChange" | "type" | "value"> & {
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  size?: "xs" | "sm" | "md";
  value: string;
};

const sizes: Record<NonNullable<SelectProps["size"]>, string> = {
  xs: "h-7 text-xs pl-2 pr-6",
  sm: "h-9 text-sm pl-3 pr-8",
  md: "h-10 text-sm pl-3 pr-8",
};

// Kept clear of the viewport edge, and of the trigger itself.
const VIEWPORT_MARGIN = 8;
const TRIGGER_GAP = 4;
const MIN_MENU_HEIGHT = 120;
const MAX_MENU_HEIGHT = 320;

type MenuPosition = { bottom?: number; left: number; maxHeight: number; top?: number; width: number };

/** Flips the menu above the trigger when there isn't enough room below (and
 *  there's more room above), clamps it horizontally inside the viewport, and
 *  caps its height to whichever side it opens toward — so it never spills off
 *  screen regardless of where the trigger sits (a panel, a modal, near an
 *  edge). */
function computePosition(trigger: HTMLElement): MenuPosition {
  const rect = trigger.getBoundingClientRect();
  const spaceBelow = window.innerHeight - rect.bottom - VIEWPORT_MARGIN;
  const spaceAbove = rect.top - VIEWPORT_MARGIN;
  const openUp = spaceBelow < MIN_MENU_HEIGHT && spaceAbove > spaceBelow;
  const maxHeight = Math.min(MAX_MENU_HEIGHT, Math.max(80, openUp ? spaceAbove : spaceBelow));
  const width = rect.width;
  const left = Math.min(Math.max(rect.left, VIEWPORT_MARGIN), window.innerWidth - width - VIEWPORT_MARGIN);
  return openUp
    ? { bottom: window.innerHeight - rect.top + TRIGGER_GAP, left, maxHeight, width }
    : { left, maxHeight, top: rect.bottom + TRIGGER_GAP, width };
}

/**
 * A styled dropdown, not a native `<select>` — WorshipApp's identity (design
 * tokens, dark cabin theme) has to reach into the option list itself, which a
 * native listbox never lets a page style. Renders its menu through a portal
 * to `document.body`, positioned in viewport coordinates (`computePosition`),
 * so it always paints above modals/panels and is never clipped by an
 * ancestor's `overflow`, unlike `Tooltip`'s in-flow bubble.
 *
 * Keyboard behavior matches the native control it replaces: Up/Down moves the
 * highlight (opening the menu first if closed), Home/End jump to the first/
 * last enabled option, Enter/Space commits, Escape closes, typing letters
 * jumps to a matching label, and Tab closes without stealing focus.
 */
export function Select({ className, disabled, onChange, options, placeholder, size = "sm", value, ...props }: SelectProps) {
  const id = useId();
  const listboxId = `${id}-listbox`;
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const typeaheadRef = useRef({ buffer: "", timer: 0 });

  const selectedIndex = options.findIndex((o) => o.value === value);
  const selectedOption = selectedIndex >= 0 ? options[selectedIndex] : undefined;

  useLayoutEffect(() => {
    if (!open) return;
    const reposition = () => {
      if (triggerRef.current) setPosition(computePosition(triggerRef.current));
    };
    reposition();
    window.addEventListener("resize", reposition);
    // capture: true — a scroll inside a nested panel or modal (the common
    // case here) never bubbles to window, only the capture phase sees it.
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  // The typeahead buffer's reset timer is the one thing in here that can
  // outlive the component: a Select unmounted within 500 ms of a keystroke
  // (a modal closing under the operator's hands) left it counting down
  // towards a ref nobody reads any more.
  useEffect(() => {
    const typeahead = typeaheadRef.current;
    return () => window.clearTimeout(typeahead.timer);
  }, []);

  function optionId(index: number) {
    return `${id}-option-${index}`;
  }

  useEffect(() => {
    if (!open || highlightedIndex < 0) return;
    document.getElementById(optionId(highlightedIndex))?.scrollIntoView({ block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- optionId is a pure function of `id`, stable across renders
  }, [open, highlightedIndex]);

  function firstEnabledIndex(): number {
    return options.findIndex((o) => !o.disabled);
  }

  function lastEnabledIndex(): number {
    for (let i = options.length - 1; i >= 0; i--) {
      if (!options[i]?.disabled) return i;
    }
    return -1;
  }

  function openMenu(initialIndex?: number) {
    if (disabled || options.length === 0 || !triggerRef.current) return;
    setPosition(computePosition(triggerRef.current));
    setHighlightedIndex(initialIndex ?? (selectedIndex >= 0 ? selectedIndex : firstEnabledIndex()));
    setOpen(true);
  }

  function selectOption(index: number) {
    const option = options[index];
    if (!option || option.disabled) return;
    onChange(option.value);
    setOpen(false);
    triggerRef.current?.focus();
  }

  function moveHighlight(delta: number) {
    setHighlightedIndex((current) => {
      const count = options.length;
      if (count === 0) return -1;
      let index = current;
      for (let i = 0; i < count; i++) {
        index = (index + delta + count) % count;
        if (!options[index]?.disabled) return index;
      }
      return current;
    });
  }

  function handleTypeahead(char: string) {
    const state = typeaheadRef.current;
    window.clearTimeout(state.timer);
    state.buffer += char.toLowerCase();
    state.timer = window.setTimeout(() => {
      state.buffer = "";
    }, 500);

    const count = options.length;
    const startAt = open ? highlightedIndex + 1 : 0;
    for (let i = 0; i < count; i++) {
      const index = (startAt + i) % count;
      const option = options[index];
      if (option && !option.disabled && option.label.toLowerCase().startsWith(state.buffer)) {
        if (open) setHighlightedIndex(index);
        else openMenu(index);
        return;
      }
    }
  }

  function handleKeyDown(e: ReactKeyboardEvent<HTMLButtonElement>) {
    if (disabled) return;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        if (open) moveHighlight(1);
        else openMenu();
        break;
      case "ArrowUp":
        e.preventDefault();
        if (open) moveHighlight(-1);
        else openMenu();
        break;
      case "Home":
        if (open) {
          e.preventDefault();
          setHighlightedIndex(firstEnabledIndex());
        }
        break;
      case "End":
        if (open) {
          e.preventDefault();
          setHighlightedIndex(lastEnabledIndex());
        }
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        if (open) selectOption(highlightedIndex);
        else openMenu();
        break;
      case "Escape":
        if (open) {
          e.preventDefault();
          setOpen(false);
        }
        break;
      case "Tab":
        setOpen(false);
        break;
      default:
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) handleTypeahead(e.key);
    }
  }

  return (
    <button
      aria-activedescendant={open && highlightedIndex >= 0 ? optionId(highlightedIndex) : undefined}
      aria-controls={listboxId}
      aria-expanded={open}
      aria-haspopup="listbox"
      className={cn(
        "relative inline-flex items-center rounded-lg border border-border bg-surface text-left text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-60",
        sizes[size],
        className,
      )}
      disabled={disabled}
      onClick={() => (open ? setOpen(false) : openMenu())}
      onKeyDown={handleKeyDown}
      ref={triggerRef}
      role="combobox"
      type="button"
      {...props}
    >
      <span className={cn("min-w-0 truncate", !selectedOption && "text-subtle")}>
        {selectedOption ? selectedOption.label : (placeholder ?? "")}
      </span>
      <Icon
        className={cn(
          "pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-subtle transition-transform",
          open && "rotate-180",
        )}
        name="chevronDown"
      />
      {open && position
        ? createPortal(
            <ul
              className="fixed z-[100] overflow-y-auto rounded-lg border border-border bg-card p-1 shadow-overlay focus:outline-none"
              id={listboxId}
              ref={menuRef}
              role="listbox"
              style={{
                left: position.left,
                maxHeight: position.maxHeight,
                width: position.width,
                ...(position.top !== undefined ? { top: position.top } : { bottom: position.bottom }),
              }}
            >
              {options.map((option, index) => (
                <li
                  aria-disabled={option.disabled || undefined}
                  aria-selected={option.value === value}
                  className={cn(
                    "flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm text-foreground",
                    option.disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
                    !option.disabled && index === highlightedIndex && "bg-hover",
                  )}
                  id={optionId(index)}
                  key={option.value}
                  onClick={(e) => {
                    e.stopPropagation();
                    selectOption(index);
                  }}
                  onMouseEnter={() => !option.disabled && setHighlightedIndex(index)}
                  role="option"
                >
                  <span className="truncate">{option.label}</span>
                  {option.value === value ? <Icon className="shrink-0 text-primary-ink" name="check" /> : null}
                </li>
              ))}
            </ul>,
            document.body,
          )
        : null}
    </button>
  );
}
