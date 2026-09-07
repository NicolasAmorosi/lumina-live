import { useEffect, type RefObject } from "react";
import { invoke } from "@renderer/lib/ipc";
import type { MediaTarget } from "@shared/types/projection";

/**
 * Reports a media element's own state back to main (which forwards it to the
 * control window). This is not domain logic — the element is describing
 * itself. Driven by the browser's native events rather than a timer of our
 * own, so there is nothing to keep in sync.
 *
 * `timeupdate` fires ~4x/second, which is what the deck autoplay scheduler
 * resyncs against and what finally makes the long-pending video progress bar
 * implementable.
 */
export function useMediaStatusReporter(
  ref: RefObject<HTMLMediaElement | null>,
  target: MediaTarget,
  epoch: number,
): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const report = () => {
      void invoke("projection:reportMediaStatus", {
        target,
        epoch,
        currentTimeSeconds: el.currentTime,
        durationSeconds: Number.isFinite(el.duration) ? el.duration : 0,
        paused: el.paused,
        ended: el.ended,
      });
    };

    const events = ["timeupdate", "loadedmetadata", "play", "pause", "ended", "seeked"] as const;
    for (const event of events) el.addEventListener(event, report);
    report();

    return () => {
      for (const event of events) el.removeEventListener(event, report);
    };
  }, [ref, target, epoch]);
}
