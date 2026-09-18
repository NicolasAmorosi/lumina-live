import { create } from "zustand";
import type { AssetKind } from "@shared/constants";

/**
 * What the operator is *looking at*, which in the EasyWorship two-stage flow is
 * never the same thing as what is on the projector. It can be a schedule item,
 * a scripture verse or a library asset that isn't in the schedule at all — the
 * resource panel previews without adding.
 */
export type PreviewTarget =
  | { kind: "scheduleItem"; index: number }
  | { kind: "verse"; verseIndex: number }
  | { kind: "asset"; assetId: number; assetKind: AssetKind }
  /** A saved utility scene (a countdown, the clock, a stopwatch). Only its id
   *  — unlike the live `base`, a preview target is re-resolved on every render
   *  anyway, so holding a copy of the scene here would just be a copy that can
   *  go stale while the operator edits it. */
  | { kind: "utility"; sceneId: number };

type PreviewStoreState = {
  /** 1-based cursor inside the previewed deck, independent of the live one. */
  slideIndex: number;
  target: PreviewTarget | null;
  /** For a video/audio target: where the preview currently is. Doubles as
   *  where EN VIVO should start it — the same value whether the preview is
   *  paused (the old "pick a start point" flow) or was actually playing.
   *  Kept updated live by `use-preview-media-status.ts` while a video plays;
   *  for audio it only ever moves via the scrubber, exactly as before. */
  positionSeconds: number;
  /** Declarative — a preview video plays only while this is true, and only a
   *  click on the preview media bar's own play button ever sets it. Never
   *  autoplay: the preview target changes on every library click, and
   *  spinning up/tearing down a decoder on each one is the exact pattern
   *  that produces PIPELINE_ERROR_DECODE on macOS (see LiveVideo/videoUnderlay).
   *  This never reaches `projection.store` — it's local to the control
   *  window and never crosses IPC. */
  playing: boolean;
  /** Reported by the real preview `<video>` element once its metadata loads;
   *  0 until then (and always 0 for audio, which still uses the detached
   *  `useMediaDuration` probe instead). */
  durationSeconds: number;

  clear: () => void;
  setSlideIndex: (index: number) => void;
  setTarget: (target: PreviewTarget) => void;
  setPositionSeconds: (seconds: number) => void;
  setPlaying: (playing: boolean) => void;
  setDurationSeconds: (seconds: number) => void;
};

export const usePreviewStore = create<PreviewStoreState>((set) => ({
  slideIndex: 1,
  target: null,
  positionSeconds: 0,
  playing: false,
  durationSeconds: 0,

  clear: () => set({ target: null, slideIndex: 1, positionSeconds: 0, playing: false, durationSeconds: 0 }),
  setSlideIndex: (slideIndex) => set({ slideIndex: Math.max(1, slideIndex) }),
  // A new target always starts at its first slide/verse and its own beginning,
  // paused — never autoplay on a fresh selection.
  setTarget: (target) =>
    set({ target, slideIndex: 1, positionSeconds: 0, playing: false, durationSeconds: 0 }),
  setPositionSeconds: (seconds) => set({ positionSeconds: Math.max(0, seconds) }),
  setPlaying: (playing) => set({ playing }),
  setDurationSeconds: (seconds) => set({ durationSeconds: Math.max(0, seconds) }),
}));
