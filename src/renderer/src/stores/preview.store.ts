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
  | { kind: "asset"; assetId: number; assetKind: AssetKind };

type PreviewStoreState = {
  /** 1-based cursor inside the previewed deck, independent of the live one. */
  slideIndex: number;
  target: PreviewTarget | null;
  /** For a video/audio target: where EN VIVO should start it, chosen on the
   *  preview media bar's scrubber. Silence-only in the control window — this
   *  never plays anything locally, it only decides a starting point. */
  startAtSeconds: number;

  clear: () => void;
  setSlideIndex: (index: number) => void;
  setTarget: (target: PreviewTarget) => void;
  setStartAtSeconds: (seconds: number) => void;
};

export const usePreviewStore = create<PreviewStoreState>((set) => ({
  slideIndex: 1,
  target: null,
  startAtSeconds: 0,

  clear: () => set({ target: null, slideIndex: 1, startAtSeconds: 0 }),
  setSlideIndex: (slideIndex) => set({ slideIndex: Math.max(1, slideIndex) }),
  // A new target always starts at its first slide/verse and its own beginning.
  setTarget: (target) => set({ target, slideIndex: 1, startAtSeconds: 0 }),
  setStartAtSeconds: (seconds) => set({ startAtSeconds: Math.max(0, seconds) }),
}));
