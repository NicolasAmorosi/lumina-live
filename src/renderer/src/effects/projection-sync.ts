import { api } from "@renderer/lib/api";
import { onIpc } from "@renderer/lib/ipc";
import { selectOutputMemo, useProjectionStore } from "@renderer/stores/projection.store";
import { useAudioStore, type LiveAudioTrack } from "@renderer/stores/audio.store";
import { useDeckStore } from "@renderer/stores/deck.store";
import { startDeckAutoplay } from "./deck-autoplay";
import { startEndOfPlaybackEffects } from "./end-of-playback";
import type { AudioTrackPush, ProjectionOutput } from "@shared/types/projection";

/**
 * `track.paused` is the operator's own declarative pause and must survive a
 * NEGRO/LOGO round-trip unchanged (same rule as `VideoUnderlay.paused` vs.
 * `LiveVideo`'s `covered`) — so covering is combined into the pushed value
 * here, never written back into `useAudioStore`. Only the deck's own
 * soundtrack reacts to the cover; a standalone audio asset sent live is
 * intentionally independent of what's on screen (see `audio.store.ts`).
 */
function toAudioTrackPush(track: LiveAudioTrack, covered: boolean): AudioTrackPush {
  return {
    trackId: track.trackId,
    url: track.url,
    epoch: track.epoch,
    paused: track.paused || (track.source === "deck" && covered),
    startAtSeconds: track.startAtSeconds,
  };
}

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
  // Coalesced into a microtask rather than sent on every `set()`: a single
  // user action (e.g. `goLiveWithDeck` — `setLiveDeck` + `setBase` +
  // `setOverlay`, all synchronous) fires this listener once per call, and
  // without batching, the projector would briefly show each intermediate
  // state — most visibly, `clearLive()`'s `setOverlay("none")` before
  // `setBase(null)` would flash whatever was still live for a frame before
  // landing on the logo. Queuing the *last* value and flushing once per
  // microtask means only the final state of a synchronous batch is ever
  // pushed, which is also what makes a single scene transition (one
  // `sceneEpoch`) correspond to exactly one push to the projection window.
  let pendingOutput: ProjectionOutput | null = null;
  let flushScheduled = false;
  const unsubscribeOutput = useProjectionStore.subscribe(selectOutputMemo, (next) => {
    pendingOutput = next;
    if (flushScheduled) return;
    flushScheduled = true;
    queueMicrotask(() => {
      flushScheduled = false;
      if (pendingOutput) void api.projection.show(pendingOutput);
    });
  });

  const pushAudioTracks = () => {
    const covered = useProjectionStore.getState().overlay !== "none";
    const tracks = useAudioStore.getState().tracks;
    void api.projection.setAudioTracks(tracks.map((track) => toAudioTrackPush(track, covered)));
  };

  const unsubscribeAudioTracks = useAudioStore.subscribe((state) => state.tracks, pushAudioTracks);
  // Re-push on every overlay toggle too, purely to recompute the deck-track's
  // effective `paused` above — `useAudioStore.tracks` itself doesn't change.
  const unsubscribeOverlayForAudio = useProjectionStore.subscribe(
    (state) => state.overlay,
    pushAudioTracks,
  );

  const unsubscribeStatus = onIpc("media-status", (status) => {
    useProjectionStore.getState().setMediaStatus(status);

    // A standalone audio track that finished on its own just disappears —
    // the operator never has to clean it up. The deck's own soundtrack is
    // exempt: it belongs to the deck's lifecycle (restart, re-sync), not to
    // "this one play finished".
    const { target } = status;
    if (status.ended && target.kind === "audio") {
      const track = useAudioStore.getState().tracks.find((t) => t.trackId === target.trackId);
      if (track?.source === "asset") useAudioStore.getState().removeTrack(track.trackId);
    }
  });

  const unsubscribeProgress = onIpc("deck-progress", (progress) => {
    useDeckStore.getState().applyProgress(progress);
  });

  const stopAutoplay = startDeckAutoplay();
  const stopEndOfPlayback = startEndOfPlaybackEffects();

  return () => {
    unsubscribeOutput();
    unsubscribeAudioTracks();
    unsubscribeOverlayForAudio();
    unsubscribeStatus();
    unsubscribeProgress();
    stopAutoplay();
    stopEndOfPlayback();
  };
}
