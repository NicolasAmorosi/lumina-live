import { api } from "@renderer/lib/api";
import { onIpc } from "@renderer/lib/ipc";
import { selectOutputMemo, useProjectionStore } from "@renderer/stores/projection.store";
import { useDeckStore } from "@renderer/stores/deck.store";
import { startDeckAutoplay } from "./deck-autoplay";

/**
 * Wires the control window to main. What used to live here — the PowerPoint
 * overlay dance, which hid the projection window so PowerPoint's own fullscreen
 * slideshow could show through — is gone: slides are images now, the projection
 * window is never hidden, and NEGRO/LOGO work through `selectOutput` like any
 * other content.
 *
 * `selectOutputMemo` gives the subscription stable identity, so the default
 * comparator is enough and no equalityFn workaround is needed.
 */
export function startProjectionEffects(): () => void {
  const unsubscribeOutput = useProjectionStore.subscribe(selectOutputMemo, (next) => {
    void api.projection.show(next);
  });

  const unsubscribeStatus = onIpc("media-status", (status) => {
    useProjectionStore.getState().setMediaStatus(status);
  });

  const unsubscribeProgress = onIpc("deck-progress", (progress) => {
    useDeckStore.getState().applyProgress(progress);
  });

  const stopAutoplay = startDeckAutoplay();

  return () => {
    unsubscribeOutput();
    unsubscribeStatus();
    unsubscribeProgress();
    stopAutoplay();
  };
}
