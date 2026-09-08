import { api } from "@renderer/lib/api";
import { onIpc } from "@renderer/lib/ipc";
import { selectOutputMemo, useProjectionStore } from "@renderer/stores/projection.store";
import { useAudioStore, type LiveAudioTrack } from "@renderer/stores/audio.store";
import { useDeckStore } from "@renderer/stores/deck.store";
import { startDeckAutoplay } from "./deck-autoplay";
import { startEndOfPlaybackEffects } from "./end-of-playback";
import type { AudioTrackPush } from "@shared/types/projection";

function toAudioTrackPush(track: LiveAudioTrack): AudioTrackPush {
  return {
    trackId: track.trackId,
    url: track.url,
    epoch: track.epoch,
    paused: track.paused,
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
  const unsubscribeOutput = useProjectionStore.subscribe(selectOutputMemo, (next) => {
    void api.projection.show(next);
  });

  const unsubscribeAudioTracks = useAudioStore.subscribe(
    (state) => state.tracks,
    (tracks) => {
      void api.projection.setAudioTracks(tracks.map(toAudioTrackPush));
    },
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
    unsubscribeStatus();
    unsubscribeProgress();
    stopAutoplay();
    stopEndOfPlayback();
  };
}
