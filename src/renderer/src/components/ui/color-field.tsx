import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { cn } from "@renderer/lib/utils";
import { computeMenuPosition, type MenuPosition } from "./floating-menu";

/**
 * The colours a scene can be painted with, straight out of the church's own
 * identity system (ALPS — see the palette table in
 * `docs/knowledge/06-ui-and-theme.md`).
 *
 * These are CONTENT values, not design tokens: they end up stored in a row and
 * rendered into an inline style on the projector, exactly like a program's
 * name. That is why they may be hex literals here while `CLAUDE.md` forbids a
 * hex anywhere in a component's classes — the projector's stage is not themed,
 * and a scene must look the same whatever theme the control window is in.
 *
 * The names are the palette's own proper nouns and are deliberately not run
 * through `i18n`: "Campfire" is the colour's name, not a description of it.
 */
const SCENE_COLOR_PRESETS: readonly { name: string; value: string }[] = [
  { name: "Blanco", value: "#ffffff" },
  { name: "Gris claro", value: "#f5f5f5" },
  { name: "Gris", value: "#717171" },
  { name: "Negro", value: "#000000" },
  { name: "Denim darker", value: "#04132b" },
  { name: "Denim", value: "#2f557f" },
  { name: "Denim light", value: "#2e6de7" },
  { name: "Denim lighter", value: "#84adfc" },
  { name: "Campfire", value: "#cd4900" },
  { name: "Tree Frog", value: "#2b8500" },
  { name: "Ming", value: "#007f98" },
  { name: "Iris", value: "#9013fe" },
  { name: "Emperor", value: "#4b207f" },
  { name: "Scarlett", value: "#d0021b" },
];

const PICKER_WIDTH_PX = 232;

/** Exactly `#rrggbb` — the one canonical form the row validator accepts. */
const HEX = /^#[0-9a-fA-F]{6}$/;

type ColorFieldProps = {
  className?: string;
  /** Accessible name of the trigger: it shows a swatch and a hex, neither of
   *  which says WHICH colour of the scene this is. */
  label: string;
  onChange: (value: string) => void;
  value: string;
};

/**
 * A colour, picked from the official palette or typed as a hex.
 *
 * Opens a portalled popover for the same reason `Select` and `Menu` do: every
 * panel and dialog in this app clips its overflow, so a swatch grid laid out
 * in flow is a grid the operator cannot see. Shares `computeMenuPosition` with
 * them, so it flips and clamps identically.
 *
 * The free-form field is a real `<input type="color">` next to the hex box,
 * not instead of it: the native picker is the only way to reach a colour that
 * is not in the palette with a mouse, and the hex box is the only way to type
 * one a designer handed over. Both commit only a valid `#rrggbb`, so the row
 * never holds a half-typed value.
 */
export function ColorField({ className, label, onChange, value }: ColorFieldProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<MenuPosition | null>(null);
  /** What is in the hex box while it is being typed. `null` means "show the
   *  committed value" — anything else is a draft that has not parsed yet. */
  const [draft, setDraft] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const reposition = () => {
      if (triggerRef.current) setPosition(computeMenuPosition(triggerRef.current, PICKER_WIDTH_PX, "end"));
    };
    reposition();
    window.addEventListener("resize", reposition);
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
      if (triggerRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function close(refocus: boolean) {
    setOpen(false);
    setDraft(null);
    if (refocus) triggerRef.current?.focus();
  }

  function commitDraft(next: string) {
    setDraft(next);
    if (HEX.test(next)) onChange(next.toLowerCase());
  }

  function handlePopoverKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Escape") return;
    e.preventDefault();
    // Stopped, because `Modal` listens for Escape on `document`: without this
    // one press would close the picker AND the dialog the operator is editing
    // in, losing the form. React attaches its listeners to a portal's own
    // container, so this runs before the event ever reaches `document`.
    e.stopPropagation();
    close(true);
  }

  const hex = draft ?? value;
  const invalid = draft !== null && !HEX.test(draft);

  return (
    <>
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={label}
        className={cn(
          "flex h-7 cursor-pointer items-center gap-2 rounded-lg border border-border bg-surface px-2 text-xs text-foreground transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
          open && "border-primary",
          className,
        )}
        onClick={() => (open ? close(false) : setOpen(true))}
        ref={triggerRef}
        type="button"
      >
        {/* A checkerboard behind the swatch would be noise: a scene colour is
            always opaque. The ring is what keeps white readable on the light
            theme's white surface. */}
        <span
          className="size-4 shrink-0 rounded-sm ring-1 ring-border ring-inset"
          style={{ background: value }}
        />
        <span className="font-mono tabular-nums uppercase">{value}</span>
      </button>

      {open && position
        ? createPortal(
            // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- the tab stops inside this popover are the swatches and the two inputs; Escape has to close it from whichever one holds focus, which is a handler on the container by definition. Same delegated pattern `Select`, `Menu` and `Tabs` use — see `.claude/knowledge/jsx-a11y-reads-one-element-so-every-delegated-keyboard-pattern-is-an-error.md`.
            <div
              aria-label={label}
              className="fixed z-[var(--z-popover)] flex flex-col gap-2 rounded-lg border border-border bg-card p-2 shadow-overlay"
              onKeyDown={handlePopoverKeyDown}
              ref={popoverRef}
              role="dialog"
              style={{
                left: position.left,
                width: position.width,
                ...(position.top !== undefined ? { top: position.top } : { bottom: position.bottom }),
              }}
            >
              <div className="grid grid-cols-7 gap-1">
                {SCENE_COLOR_PRESETS.map((preset) => (
                  <button
                    aria-label={preset.name}
                    aria-pressed={preset.value === value.toLowerCase()}
                    className={cn(
                      "size-7 cursor-pointer rounded-md ring-1 ring-border ring-inset transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      preset.value === value.toLowerCase() && "ring-2 ring-primary",
                    )}
                    key={preset.value}
                    onClick={() => {
                      onChange(preset.value);
                      setDraft(null);
                    }}
                    style={{ background: preset.value }}
                    title={preset.name}
                    type="button"
                  />
                ))}
              </div>

              <div className="flex items-center gap-1.5">
                <input
                  aria-label={label}
                  className="size-7 shrink-0 cursor-pointer rounded-md border border-border bg-surface p-0.5"
                  onChange={(e) => {
                    onChange(e.target.value.toLowerCase());
                    setDraft(null);
                  }}
                  type="color"
                  value={HEX.test(value) ? value : "#000000"}
                />
                <input
                  aria-invalid={invalid || undefined}
                  aria-label={label}
                  className="h-7 w-full rounded-lg border border-border bg-surface px-2 font-mono text-xs text-foreground uppercase focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:outline-none aria-invalid:border-danger/80"
                  maxLength={7}
                  onChange={(e) => commitDraft(e.target.value)}
                  spellCheck={false}
                  value={hex}
                />
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
