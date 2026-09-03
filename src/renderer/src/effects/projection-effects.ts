import { api } from "@renderer/lib/api";
import { selectOutput, useProjectionStore } from "@renderer/stores/projection.store";
import type { ProjectionOutput } from "@shared/types/projection";

let linkedAudio: HTMLAudioElement | null = null;

export function setLinkedAudio(audio: HTMLAudioElement | null): void {
  linkedAudio = audio;
}

function outputsEqual(a: ProjectionOutput | undefined, b: ProjectionOutput): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * The one place that still has "order matters" logic — the PowerPoint overlay
 * dance (docs/knowledge/03-powerpoint-com.md in the legacy app) and pausing
 * linked audio during black/logo. Everything else about "what should be on
 * screen" is the pure `selectOutput` selector; this subscriber only ever
 * *reacts* to what that selector produces, diffing previous vs. next.
 *
 * Call once at app startup (App.tsx) and keep the returned unsubscribe for
 * symmetry, though the control window never tears this down in practice.
 */
export function startProjectionEffects(): () => void {
  let previous: ProjectionOutput | undefined;

  const unsubscribe = useProjectionStore.subscribe(
    selectOutput,
    async (next) => {
      const leavingPpt = previous?.kind === "ppt" && next.kind !== "ppt";
      const enteringPpt = next.kind === "ppt" && previous?.kind !== "ppt";

      if (leavingPpt) await api.projection.setOverlayVisible(true);
      await api.projection.show(next);
      if (enteringPpt) await api.projection.setOverlayVisible(false);

      if (linkedAudio) {
        const shouldPause = next.kind === "black" || next.kind === "logo";
        if (shouldPause) linkedAudio.pause();
        else if (linkedAudio.paused) void linkedAudio.play().catch(() => {});
      }

      previous = next;
    },
    // selectOutput returns a fresh object every store change — without this,
    // the listener (and its projection:show IPC call) fires on any unrelated
    // store update (e.g. presentationOpen toggling), not just real output changes.
    { equalityFn: outputsEqual },
  );

  return unsubscribe;
}
