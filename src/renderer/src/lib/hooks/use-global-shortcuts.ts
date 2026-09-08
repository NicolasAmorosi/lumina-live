import { useEffect } from "react";
import { useProjectionStore } from "@renderer/stores/projection.store";
import { advanceSlide, goLive, toggleOverlay } from "@renderer/lib/actions/playback";
import { advancePreview } from "@renderer/lib/actions/preview";
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
 * Suppressed while `suspended` (e.g. the Services modal is open) or when the
 * focused element is an input/select/textarea/button/link.
 */
export function useGlobalShortcuts(suspended: boolean): void {
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
