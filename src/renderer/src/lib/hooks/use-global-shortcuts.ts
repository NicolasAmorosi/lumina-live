import { useEffect } from "react";
import { useProjectionStore } from "@renderer/stores/projection.store";
import { advanceSlide, goLive, toggleOverlay } from "@renderer/lib/actions/playback";
import { advancePreview } from "@renderer/lib/actions/preview";
import { toggleAutoplay } from "@renderer/effects/deck-autoplay";
import { advanceVerse } from "@renderer/lib/actions/bible";
import { removeSelected } from "@renderer/lib/actions/remove-selected";

const ARROW_KEYS_LIST: string[] = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];

// A text field consumes every keystroke — anything else would type into it.
const TEXT_ENTRY_TAGS = new Set(["INPUT", "SELECT", "TEXTAREA"]);
// ...except the `<input>` types that are not text entry at all. A range is a
// slider: it owns the arrows (and Home/End/PageUp/PageDown) and nothing else.
// Treating it as a text field would have made `b` and `l` — NEGRO and LOGO,
// the controls an operator reaches for when something appears the
// congregation should not see — dead for as long as a volume slider kept
// focus, which is right after they touched one. Same defect the comment on
// `suppressesKey` describes for buttons, by a different route.
const SLIDER_INPUT_KEYS = new Set([...ARROW_KEYS_LIST, "Home", "End", "PageUp", "PageDown"]);
// A button or a link consumes only the keys that actually do something to it:
// Enter and Space activate it, and the arrows drive the roving tabindex of the
// resource grid.
const ACTIVATION_TAGS = new Set(["BUTTON", "A"]);
const ARROW_KEYS = new Set(ARROW_KEYS_LIST);
const KEYS_A_CONTROL_CONSUMES = new Set(["Enter", " ", ...ARROW_KEYS]);
// Widgets whose arrows belong to them, declared by role instead of implied by
// a tag. `MediaScrubber` is what forced this: a `<div role="slider">` with its
// own arrow handling, so on a focused scrubber ArrowRight seeked five seconds
// AND advanced the live slide — in the same keypress, with the operator only
// asking for one of them. A `<div>` is not in `ACTIVATION_TAGS`, so nothing
// caught it; the role is exactly the declaration that says it should be.
const ARROW_CONSUMING_ROLES = new Set([
  "slider",
  "spinbutton",
  "listbox",
  "option",
  "combobox",
  "menu",
  "menubar",
  "menuitem",
  "tab",
  "tablist",
  "tree",
  "treeitem",
  "grid",
]);

/**
 * The element that took focus from a pointer press, if the focused one did.
 *
 * Enter, Space and the arrows on a button mean two different things depending
 * on how the operator got there. Reached with Tab, they are that button's own
 * keys. Clicked, they are not: Chromium focuses a button on click, so after
 * touching «Pausar» or a resource tile, Enter pressed that button again instead
 * of going EN VIVO, which is the one key an operator presses blind — and after
 * clicking EN VIVO itself, → no longer moved the verse or the slide that had
 * just gone live, and Space pressed EN VIVO again (a new scene: the video and
 * the deck's music back to 0). `:focus-visible` cannot tell the two apart here.
 * Chromium flips it to true on the very keydown being handled, already in the
 * capture phase (measured 2026-10-14). So the modality is recorded when focus
 * moves instead.
 */
let pointerFocused: EventTarget | null = null;
let pointerDown = false;

/**
 * Per KEY, not per element.
 *
 * Suppressing every shortcut whenever a `<button>` had focus looked harmless
 * and was not: Chromium focuses a button when you click it, so after a single
 * click on ANY button in the app — EN VIVO, LOGO, save, any `IconButton` — the
 * `b` and `l` shortcuts stopped working, with nothing on screen to say why.
 * NEGRO is the control an operator reaches for when something appears that the
 * congregation should not see, and it was dead for the rest of the service
 * unless they happened to click on empty space. `b`, `l`, Delete and Backspace
 * mean nothing to a button, so there was never anything to protect.
 */
function suppressesKey(target: EventTarget | null, key: string): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLInputElement && target.type === "range") {
    return SLIDER_INPUT_KEYS.has(key);
  }
  if (target.isContentEditable || TEXT_ENTRY_TAGS.has(target.tagName)) return true;
  if (ACTIVATION_TAGS.has(target.tagName) && KEYS_A_CONTROL_CONSUMES.has(key)) {
    // A tab is a button that owns its arrows however it got focus.
    const role = target.getAttribute("role");
    if (role !== null && ARROW_CONSUMING_ROLES.has(role) && ARROW_KEYS.has(key)) return true;
    return target !== pointerFocused;
  }
  const role = target.getAttribute("role");
  return role !== null && ARROW_CONSUMING_ROLES.has(role) && ARROW_KEYS.has(key);
}

/**
 * App-wide keyboard shortcuts, mounted once from App.tsx. The split follows
 * the two-stage flow, which is what makes them safe to press blind:
 *
 * - ←/→: navigate what is LIVE — the deck on the projector, or the verse on it.
 *   Derived from `base`, not from which panel has focus, so the arrows always
 *   mean the same thing.
 * - ↑/↓: navigate the PREVIEW cursor. Nothing reaches the projector.
 * - Enter: send the preview to the projector (the EN VIVO button), also right
 *   after clicking a button with the mouse — see `pointerFocused`.
 * - Space: pause/resume a self-advancing deck. The one shortcut a PPT that
 *   plays by itself really needs: the operator has to be able to freeze it.
 * - B/L: toggle NEGRO/LOGO overlay.
 * - Delete/Backspace: remove the selected library or schedule item.
 *
 * Suppressed entirely while `suspended` (any modal open — see
 * `useAnyModalOpen`) or while a text field has focus. On a focused button,
 * link, or element carrying a widget role, only the keys that control actually
 * consumes are suppressed — see `suppressesKey` — and on a button the mouse
 * focused, not even those: all of the above keep working right after a click.
 */
export function useGlobalShortcuts(suspended: boolean): void {
  // Always on, modal or not: what matters is how the focused element got its
  // focus, whenever that was.
  useEffect(() => {
    const onPointerDown = () => {
      pointerDown = true;
    };
    const onPointerUp = () => {
      pointerDown = false;
    };
    const onFocusIn = (e: FocusEvent) => {
      pointerFocused = pointerDown ? e.target : null;
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("pointerup", onPointerUp, true);
    window.addEventListener("pointercancel", onPointerUp, true);
    window.addEventListener("focusin", onFocusIn, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("pointerup", onPointerUp, true);
      window.removeEventListener("pointercancel", onPointerUp, true);
      window.removeEventListener("focusin", onFocusIn, true);
    };
  }, []);

  useEffect(() => {
    if (suspended) return;

    function onKeyDown(e: KeyboardEvent): void {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // A key a widget already handled is not a shortcut. `Select` answers
      // Enter on its own trigger, which is a button the mouse may have focused,
      // and choosing a Bible version must not also send the preview live.
      if (e.defaultPrevented) return;
      if (suppressesKey(e.target, e.key)) return;

      switch (e.key) {
        case "Delete":
        case "Backspace":
          e.preventDefault();
          removeSelected();
          return;
        case "ArrowLeft":
        case "ArrowRight": {
          const direction = e.key === "ArrowRight" ? 1 : -1;
          const base = useProjectionStore.getState().base;
          if (base?.kind === "deck") {
            e.preventDefault();
            advanceSlide(direction);
          } else if (base?.kind === "bible") {
            e.preventDefault();
            advanceVerse(direction);
          }
          return;
        }
        case "ArrowUp":
        case "ArrowDown":
          e.preventDefault();
          advancePreview(e.key === "ArrowDown" ? 1 : -1);
          return;
        case " ": {
          // Prevented even when it does nothing here: reaching this switch
          // from a clicked button, Space would otherwise press that button
          // again (see `pointerFocused`).
          e.preventDefault();
          const { base, liveDeck } = useProjectionStore.getState();
          if (base?.kind === "deck" && liveDeck?.autoAdvance) toggleAutoplay();
          return;
        }
        case "b":
        case "B":
          e.preventDefault();
          void toggleOverlay("black");
          return;
        case "l":
        case "L":
          e.preventDefault();
          void toggleOverlay("logo");
          return;
        case "Enter":
          e.preventDefault();
          void goLive();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [suspended]);
}
