import { useProjectionStore } from "@renderer/stores/projection.store";
import { useAudioStore, DECK_SOUNDTRACK_TRACK_ID } from "@renderer/stores/audio.store";
import { toggleAutoplay } from "@renderer/effects/deck-autoplay";
import { api } from "@renderer/lib/api";
import type { MediaTarget } from "@shared/types/projection";

/** Pauses/resumes the live video. Declarative — see `VideoUnderlay.paused` —
 *  so it survives a NEGRO/LOGO round-trip instead of NEGRO silently
 *  overriding an operator's explicit pause. */
export function toggleVideoPause(): void {
  const { videoPaused, setVideoPaused } = useProjectionStore.getState();
  setVideoPaused(!videoPaused);
}

/**
 * Pauses/resumes one audio track. The deck's own soundtrack is special-cased
 * to `toggleAutoplay()` (`effects/deck-autoplay.ts`) rather than flipping
 * `paused` directly — pausing that track has to pause the slide auto-advance
 * with it, since the two are the same clock (per-product decision: pausing
 * a PPT's music pauses the PPT).
 */
export function toggleAudioTrackPause(trackId: string): void {
  if (trackId === DECK_SOUNDTRACK_TRACK_ID) {
    toggleAutoplay();
    return;
  }
  const track = useAudioStore.getState().tracks.find((t) => t.trackId === trackId);
  if (track) useAudioStore.getState().setPaused(trackId, !track.paused);
}

/** One-shot seek command — the target is already playing, this just moves it. */
export function seekMedia(target: MediaTarget, seconds: number): void {
  void api.projection.mediaCommand({ target, action: "seek", timeSeconds: Math.max(0, seconds) });
}

/** Stops a standalone audio track and drops its row — never available for the
 *  video or the deck's soundtrack, so there is no button anywhere that can
 *  cut what's actually on the projector. */
export function stopAudioTrack(trackId: string): void {
  useAudioStore.getState().removeTrack(trackId);
}
