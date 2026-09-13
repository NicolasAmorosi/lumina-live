import { useEffect } from "react";
import { useProjectionStore } from "@renderer/stores/projection.store";
import { advanceSlide, goLive, toggleOverlay } from "@renderer/lib/actions/playback";
import { advancePreview } from "@renderer/lib/actions/preview";
import { toggleAutoplay } from "@renderer/effects/deck-autoplay";
import { advanceVerse } from "@renderer/lib/actions/bible";
import { removeSelected } from "@renderer/lib/actions/remove-selected";

// A text field consumes every keystroke — anything else would type into it.
const TEXT_ENTRY_TAGS = new Set(["INPUT", "SELECT", "TEXTAREA"]);
// A button or a link consumes only the keys that actually do something to it:
// Enter and Space activate it, and the arrows drive the roving tabindex of the
// resource grid.
const ACTIVATION_TAGS = new Set(["BUTTON", "A"]);
const KEYS_A_CONTROL_CONSUMES = new Set([
  "Enter",
  " ",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
]);

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
  if (target.isContentEditable || TEXT_ENTRY_TAGS.has(target.tagName)) return true;
  return ACTIVATION_TAGS.has(target.tagName) && KEYS_A_CONTROL_CONSUMES.has(key);
}

/**
 * App-wide keyboard shortcuts, mounted once from App.tsx. The split follows
 * the two-stage flow, which is what makes them safe to press blind:
 *
 * - ←/→: navigate what is LIVE — the deck on the projector, or the verse on it.
 *   Derived from `base`, not from which panel has focus, so the arrows always
 *   mean the same thing.
 * - ↑/↓: navigate the PREVIEW cursor. Nothing reaches the projector.
 * - Enter: send the preview to the projector (the EN VIVO button).
 * - Space: pause/resume a self-advancing deck. The one shortcut a PPT that
 *   plays by itself really needs: the operator has to be able to freeze it.
 * - B/L: toggle NEGRO/LOGO overlay.
 * - Delete/Backspace: remove the selected library or schedule item.
 *
 * Suppressed entirely while `suspended` (any modal open — see
 * `useAnyModalOpen`) or while a text field has focus. On a focused button or
 * link only the keys that control actually consumes are suppressed — see
 * `suppressesKey`.
 */
export function useGlobalShortcuts(suspended: boolean): void {
  useEffect(() => {
    if (suspended) return;

    function onKeyDown(e: KeyboardEvent): void {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
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
          const { base, liveDeck } = useProjectionStore.getState();
          if (base?.kind !== "deck" || !liveDeck?.autoAdvance) return;
          e.preventDefault();
          toggleAutoplay();
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
