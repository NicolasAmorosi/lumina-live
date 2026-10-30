import { engineAssetIdOfUrl } from "@shared/urls";
import type { AudioTrackPush, ProjectionOutput } from "@shared/types/projection";

/** What the live engine session has to be right now (`engine-sessions.ts`). */
export type LiveEngineState = {
  url: string;
  epoch: number;
  startAtSeconds: number;
  paused: boolean;
  volume: number;
};

/**
 * The live session, from the last output the projector was sent and whether the projector exists:
 * `null` unless the full-screen video is one only the engine plays.
 *
 * Pure, so the rule is tested where the rest of the suite lives. It is the `shouldPlay` the
 * projector's own `<video>` follows (`LiveVideo`: not covered by BLACK/LOGO, not paused by the
 * operator), plus the projector itself: the sound comes from the engine now, so closing the
 * projector has to silence it the way closing its window silenced a `<video>` (owner, 2026-10-30).
 */
export function liveEngineState(output: ProjectionOutput | null, projectorOpen: boolean): LiveEngineState | null {
  const video = output?.videoUnderlay;
  if (!output || !video || engineAssetIdOfUrl(video.url) === null) return null;
  return {
    url: video.url,
    epoch: video.epoch,
    startAtSeconds: video.startAtSeconds,
    paused: video.paused || output.kind !== "video" || !projectorOpen,
    volume: video.volume,
  };
}

/**
 * The live audio tracks the engine plays, from the last `AudioTrackPush[]`: only those with an engine
 * url, each paused as well while there is no projector. The control window already folded BLACK/LOGO
 * into the deck soundtrack's `paused`, and a standalone track ignores them on purpose
 * (`projection-sync.ts`); closing the projector silenced every `<audio>` with its window, and the
 * engine's tracks do the same (owner, 2026-10-30).
 */
export function liveEngineAudio(tracks: AudioTrackPush[], projectorOpen: boolean): AudioTrackPush[] {
  return tracks
    .filter((track) => engineAssetIdOfUrl(track.url) !== null)
    .map((track) => ({ ...track, paused: track.paused || !projectorOpen }));
}
