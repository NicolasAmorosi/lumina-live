import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { cn } from "@renderer/lib/utils";

type MediaScrubberTone = "primary" | "audio";

type MediaScrubberProps = {
  className?: string;
  currentSeconds: number;
  disabled?: boolean;
  durationSeconds: number;
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

/**
 * The draggable counterpart to `ProgressBar` — a real seek control, not just
 * a readout. Deliberately no width transition on the fill while dragging: a
 * CSS transition fighting the pointer position reads as lag under a finger.
 *
 * The thumb follows the pointer locally while dragging (`dragRatio`), so the
 * bar never lags behind a fast swipe waiting for a round-trip `mediaStatus`
 * update; only the release commits an actual seek.
 */
export function MediaScrubber({
  className,
  currentSeconds,
  disabled = false,
  durationSeconds,
  onSeek,
  tone = "primary",
}: MediaScrubberProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [dragRatio, setDragRatio] = useState<number | null>(null);

  const duration = Math.max(0, durationSeconds);
  const seekable = duration > 0 && !disabled;
  const knownRatio = duration > 0 ? Math.min(1, Math.max(0, currentSeconds / duration)) : 0;
  const ratio = dragRatio ?? knownRatio;

  function ratioAt(clientX: number): number {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return ratio;
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  }

  function commit(nextRatio: number) {
    if (seekable) onSeek?.(nextRatio * duration);
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!seekable) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragRatio(ratioAt(event.clientX));
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (dragRatio === null) return;
    setDragRatio(ratioAt(event.clientX));
  }

  function handlePointerUp(event: PointerEvent<HTMLDivElement>) {
    if (dragRatio === null) return;
    const next = ratioAt(event.clientX);
    setDragRatio(null);
    commit(next);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!seekable) return;
    const step = SEEK_STEP_SECONDS / duration;
    switch (event.key) {
      case "ArrowLeft":
      case "ArrowDown":
        event.preventDefault();
        commit(Math.max(0, ratio - step));
        return;
      case "ArrowRight":
      case "ArrowUp":
        event.preventDefault();
        commit(Math.min(1, ratio + step));
        return;
      case "Home":
        event.preventDefault();
        commit(0);
        return;
      case "End":
        event.preventDefault();
        commit(1);
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
