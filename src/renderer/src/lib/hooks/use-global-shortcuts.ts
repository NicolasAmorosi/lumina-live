import { useEffect } from "react";
import { useProjectionStore } from "@renderer/stores/projection.store";
import { advanceSlide, presentSelected, toggleOverlay } from "@renderer/lib/actions/playback";
import { toggleAutoplay } from "@renderer/effects/deck-autoplay";
import { advanceVerse } from "@renderer/lib/actions/bible";
import { removeSelected } from "@renderer/lib/actions/remove-selected";

// Native controls that should keep handling their own Enter/Delete/Arrow keys
// instead of triggering an app-wide shortcut underneath them.
const INTERACTIVE_TAGS = new Set(["INPUT", "SELECT", "TEXTAREA", "BUTTON", "A"]);

function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return INTERACTIVE_TAGS.has(target.tagName) || target.isContentEditable;
}

/**
 * App-wide keyboard shortcuts, mounted once from App.tsx:
 * - Delete/Backspace: remove the selected library or playlist item (removeSelected).
 * - ←/→: contextual — Bible tab active advances the current verse, otherwise
 *   advances the deck being projected.
 * - Space: pause/resume a self-advancing deck. The one shortcut a PPT that
 *   plays by itself really needs: the operator has to be able to freeze it.
 * - B/L: toggle NEGRO/LOGO overlay.
 * - Enter: present the selected playlist item ("En vivo").
 *
 * Suppressed while `suspended` (e.g. the Services modal is open) or when the
 * focused element is an input/select/textarea/button/link — those keep their
 * native Enter/Delete/Arrow behavior.
 */
export function useGlobalShortcuts(centerTab: "preview" | "bible", suspended: boolean): void {
  useEffect(() => {
    if (suspended) return;

    function onKeyDown(e: KeyboardEvent): void {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isInteractiveTarget(e.target)) return;

      switch (e.key) {
        case "Delete":
        case "Backspace":
          e.preventDefault();
          removeSelected();
          return;
        case "ArrowLeft":
        case "ArrowRight": {
          const direction = e.key === "ArrowRight" ? 1 : -1;
          if (centerTab === "bible") {
            e.preventDefault();
            advanceVerse(direction);
          } else if (useProjectionStore.getState().base?.kind === "deck") {
            e.preventDefault();
            advanceSlide(direction);
          }
          return;
        }
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
          toggleOverlay("black");
          return;
        case "l":
        case "L":
          e.preventDefault();
          toggleOverlay("logo");
          return;
        case "Enter":
          e.preventDefault();
          void presentSelected();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [centerTab, suspended]);
}
