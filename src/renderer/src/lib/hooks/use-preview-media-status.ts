import { useEffect } from "react";
import { usePreviewStore } from "@renderer/stores/preview.store";

/**
 * The preview monitor's own status reporter — the local counterpart of
 * `projection/use-media-status-reporter.ts`, but with no IPC and no
 * `MediaTarget`: there's exactly one preview element, it never leaves this
 * window, and its status must never land in `projection.store.mediaStatus`
 * (that record is keyed by `mediaTargetKey` and belongs to the projection
 * window's real elements — mixing this in would let the preview's clock
 * collide with the live video's, the same class of bug documented in
 * `.claude/knowledge/media-status-is-per-target-not-a-single-slot.md`).
 *
 * Takes the element itself (a `useState`-backed callback ref from the call
 * site), not a `RefObject` — the preview's `epoch` is deliberately frozen at
 * 0 across every target change (see `use-preview.ts`), so a plain ref
 * object's identity would never change when the element unmounts/remounts as
 * the operator switches between a video and something else. Depending on the
 * element value itself re-attaches listeners exactly when that happens.
 *
 * Driven by the element's own events, same list as the live reporter.
 */
export function usePreviewMediaStatus(element: HTMLVideoElement | null): void {
  const setPositionSeconds = usePreviewStore((s) => s.setPositionSeconds);
  const setDurationSeconds = usePreviewStore((s) => s.setDurationSeconds);
  const setPlaying = usePreviewStore((s) => s.setPlaying);

  useEffect(() => {
    if (!element) return;

    const report = () => {
      setPositionSeconds(element.currentTime);
      if (Number.isFinite(element.duration)) setDurationSeconds(element.duration);
      if (element.ended) setPlaying(false);
    };

    const events = ["timeupdate", "loadedmetadata", "play", "pause", "ended", "seeked"] as const;
    for (const event of events) element.addEventListener(event, report);
    report();

    return () => {
      for (const event of events) element.removeEventListener(event, report);
    };
  }, [element, setDurationSeconds, setPlaying, setPositionSeconds]);
}
