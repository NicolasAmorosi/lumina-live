import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { cn } from "@renderer/lib/utils";

type MediaScrubberTone = "primary" | "audio";

type MediaScrubberProps = {
  className?: string;
  currentSeconds: number;
  disabled?: boolean;
  durationSeconds: number;
  /** The position this bar is painting while it is ahead of `currentSeconds`
   *  (dragging, or waiting for a committed seek to be confirmed), and `null`
   *  the moment the reported position is authoritative again. Lets a caller's
   *  own clock read the same number the thumb is on instead of the stale
   *  report — see `MediaTrackRow`.
   *
   *  Must be identity-stable (a `useState` setter, a `useCallback`): it is an
   *  effect dependency. */
  onPositionChange?: ((seconds: number | null) => void) | undefined;
  /** Fires once, on release (pointer up) or on a keyboard nudge — never mid-drag,
   *  so scrubbing a live video doesn't flood the projector with seek commands. */
  onSeek?: ((seconds: number) => void) | undefined;
  tone?: MediaScrubberTone;
};

const toneClassName: Record<MediaScrubberTone, string> = {
  primary: "bg-primary",
  audio: "bg-badge-audio",
};

const SEEK_STEP_SECONDS = 5;

/** How close a report has to land to the committed seek to count as "that seek
 *  happened". Three status reports' worth (they arrive ~4x/second), so a
 *  position that is merely playing on past the target still confirms it. */
const SEEK_CONFIRM_TOLERANCE_SECONDS = 0.75;
/** Nothing confirmed the seek — the projection window is gone, the file is
 *  broken, the element never got there. The bar goes back to reporting what it
 *  actually knows rather than holding a position that may never be true. */
const SEEK_CONFIRM_TIMEOUT_MS = 1500;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * The draggable counterpart to `ProgressBar` — a real seek control, not just
 * a readout. Deliberately no width transition on the fill while dragging: a
 * CSS transition fighting the pointer position reads as lag under a finger.
 *
 * ## Why the bar keeps painting its own position after the release
 *
 * The thumb follows the pointer locally while dragging (`dragSeconds`), so the
 * bar never lags behind a fast swipe waiting for a round-trip `mediaStatus`
 * update; only the release commits an actual seek. Dropping that local
 * position at the release, though, is what produced the flick backwards on the
 * live panel: the committed seek travels control window → main → projection
 * window and only comes back as a `mediaStatus` report one IPC round-trip
 * later, so for those ~100-300ms the bar re-painted the last *pre-seek* report
 * — the old position — before jumping forward to the new one.
 *
 * So the released position is held as `pendingSeconds` until a report actually
 * lands on it (`SEEK_CONFIRM_TOLERANCE_SECONDS`) or the wait runs out
 * (`SEEK_CONFIRM_TIMEOUT_MS`) — never indefinitely, so the bar can't end up
 * showing a position the projector never reached. The preview bar goes through
 * the same code and simply confirms on its very next render: `seekPreview()`
 * writes its store synchronously, which is why it never flicked in the first
 * place.
 */
export function MediaScrubber({
  className,
  currentSeconds,
  disabled = false,
  durationSeconds,
  onPositionChange,
  onSeek,
  tone = "primary",
}: MediaScrubberProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [dragSeconds, setDragSeconds] = useState<number | null>(null);
  const [pendingSeconds, setPendingSeconds] = useState<number | null>(null);

  const duration = Math.max(0, durationSeconds);
  const seekable = duration > 0 && !disabled;
  /** What this bar is painting instead of the reported position, if anything. */
  const localSeconds = dragSeconds ?? pendingSeconds;
  const seconds = localSeconds ?? currentSeconds;
  const ratio = duration > 0 ? clamp(seconds / duration, 0, 1) : 0;

  // A report landed on the committed seek: the round-trip is over and the
  // reported position is authoritative again.
  useEffect(() => {
    if (pendingSeconds === null) return;
    if (Math.abs(currentSeconds - pendingSeconds) <= SEEK_CONFIRM_TOLERANCE_SECONDS) {
      setPendingSeconds(null);
    }
  }, [currentSeconds, pendingSeconds]);

  useEffect(() => {
    if (pendingSeconds === null) return;
    const timer = window.setTimeout(() => setPendingSeconds(null), SEEK_CONFIRM_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [pendingSeconds]);

  // A different file took this row over (the live panel reuses one row per
  // slot). Anything pending described the previous one.
  useEffect(() => {
    setPendingSeconds(null);
  }, [durationSeconds]);

  useEffect(() => {
    onPositionChange?.(localSeconds);
  }, [localSeconds, onPositionChange]);

  function secondsAt(clientX: number): number {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return seconds;
    return clamp((clientX - rect.left) / rect.width, 0, 1) * duration;
  }

  function commit(nextSeconds: number) {
    if (!seekable) return;
    const next = clamp(nextSeconds, 0, duration);
    setPendingSeconds(next);
    onSeek?.(next);
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!seekable) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragSeconds(secondsAt(event.clientX));
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (dragSeconds === null) return;
    setDragSeconds(secondsAt(event.clientX));
  }

  function handlePointerUp(event: PointerEvent<HTMLDivElement>) {
    if (dragSeconds === null) return;
    const next = secondsAt(event.clientX);
    setDragSeconds(null);
    commit(next);
  }

  /** The drag ended without a release the bar can read a position from — the
   *  OS took the pointer over for a gesture, the window lost focus, the touch
   *  was cancelled. `handlePointerUp` was the only thing that ever cleared
   *  `dragSeconds`, so this left the bar following the cursor with no button
   *  held down, forever, never painting the reported position again. Nothing
   *  is committed: no release means no seek the operator actually asked for. */
  function abandonDrag() {
    setDragSeconds(null);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!seekable) return;
    switch (event.key) {
      case "ArrowLeft":
      case "ArrowDown":
        event.preventDefault();
        commit(seconds - SEEK_STEP_SECONDS);
        return;
      case "ArrowRight":
      case "ArrowUp":
        event.preventDefault();
        commit(seconds + SEEK_STEP_SECONDS);
        return;
      case "Home":
        event.preventDefault();
        commit(0);
        return;
      case "End":
        event.preventDefault();
        commit(duration);
    }
  }

  const pct = Math.round(ratio * 100);

  return (
    <div
      aria-disabled={!seekable || undefined}
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={pct}
      className={cn(
        "group/scrubber relative flex h-4 w-full shrink-0 touch-none items-center",
        seekable ? "cursor-pointer" : "cursor-default opacity-50",
        className,
      )}
      onKeyDown={handleKeyDown}
      onLostPointerCapture={abandonDrag}
      onPointerCancel={abandonDrag}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      ref={trackRef}
      role="slider"
      tabIndex={seekable ? 0 : -1}
    >
      <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full", toneClassName[tone])} style={{ width: `${pct}%` }} />
      </div>
      <div
        className={cn(
          "absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full shadow-surface transition-transform group-hover/scrubber:scale-110",
          toneClassName[tone],
        )}
        style={{ left: `${pct}%` }}
      />
    </div>
  );
}
