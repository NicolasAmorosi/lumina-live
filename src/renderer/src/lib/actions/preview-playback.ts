import { usePreviewStore } from "@renderer/stores/preview.store";

/**
 * The preview monitor's own `<video>` element, registered by `PreviewMonitor`
 * via `OutputView`'s `videoRef` — same wiring `ProjectionApp` uses for the
 * projector's element, but module-scoped instead of a component ref: there is
 * no window boundary or reload to survive here, so a plain module variable is
 * enough. Never mounted for audio — audio keeps the old silent, informational
 * behaviour (see `preview-media-bar.tsx`).
 */
let previewVideoElement: HTMLVideoElement | null = null;

export function attachPreviewVideo(element: HTMLVideoElement | null): void {
  previewVideoElement = element;
}

/**
 * Play/pause is declarative — flipping `playing` here is read by
 * `use-preview.ts`'s `videoUnderlay.paused` and applied by `LiveVideo`'s own
 * effect, exactly like the live video's operator-pause. Restarts from the top
 * when the preview had reached the end, so pressing play again after a full
 * watch-through doesn't look like a no-op.
 */
export function togglePreviewPlayback(): void {
  const { durationSeconds, playing, positionSeconds, setPlaying, setPositionSeconds } =
    usePreviewStore.getState();
  if (!playing && durationSeconds > 0 && positionSeconds >= durationSeconds) {
    setPositionSeconds(0);
    if (previewVideoElement) previewVideoElement.currentTime = 0;
  }
  setPlaying(!playing);
}

/**
 * One-shot seek, imperative on the element exactly like the live video's own
 * `seekMedia` — but purely local, no IPC. Also used for an audio target,
 * which has no element mounted (`previewVideoElement` stays null): in that
 * case this only records the chosen start point, same as before.
 */
export function seekPreview(seconds: number): void {
  const next = Math.max(0, seconds);
  usePreviewStore.getState().setPositionSeconds(next);
  if (previewVideoElement) previewVideoElement.currentTime = next;
}

/** Stops the preview without losing its position — called right before
 *  EN VIVO hands the same file to the projector, so there is never more than
 *  one active decode of it at a time. */
export function stopPreviewPlayback(): void {
  usePreviewStore.getState().setPlaying(false);
}
