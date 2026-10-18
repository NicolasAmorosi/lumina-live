import { useEffect, type RefObject } from "react";
import { invoke } from "@renderer/lib/ipc";
import type { MediaTarget } from "@shared/types/projection";

/**
 * Reports a media element's own state back to main (which forwards it to the
 * control window). This is not domain logic — the element is describing
 * itself. Driven by the browser's own events rather than a timer of our own,
 * so there is nothing to keep in sync.
 *
 * `timeupdate` fires ~4x/second, which is what the deck autoplay scheduler
 * resyncs against and what drives every media transport bar's progress.
 *
 * `trackId` is `null` for the two single-slot elements (the full-screen video
 * and the live slide's own video, told apart by `singleSlot`) and the track's
 * own id for an audio element — kept as primitives (not a `MediaTarget`
 * object) so the effect's dependency array stays stable identity, not a fresh
 * object every render.
 */
export function useMediaStatusReporter(
  ref: RefObject<HTMLMediaElement | null>,
  trackId: string | null,
  epoch: number,
  singleSlot: "video" | "slideVideo" = "video",
): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const target: MediaTarget = trackId === null ? { kind: singleSlot } : { kind: "audio", trackId };

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
  }, [ref, trackId, epoch, singleSlot]);
}
