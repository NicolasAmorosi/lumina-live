import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import type { BaseContent, OverlayState, ProjectionOutput } from "@shared/types/projection";
import { assetUrl, LOGO_URL } from "@shared/urls";

type ProjectionStoreState = {
  base: BaseContent | null;
  overlay: OverlayState;
  logoUrl: string | null;
  presentationOpen: boolean;
  // Mirrors the open PowerPoint COM session's slide cursor (main is the real
  // source of truth) so both PreviewPanel's counter and the global ←/→
  // shortcut (use-global-shortcuts.ts) read/advance the same number.
  pptSlide: number;
  pptTotal: number;
  setBase: (base: BaseContent | null) => void;
  setOverlay: (overlay: OverlayState) => void;
  setLogoUrl: (url: string | null) => void;
  setPresentationOpen: (open: boolean) => void;
  setPptSlide: (slide: number) => void;
  setPptTotal: (total: number) => void;
};

export const useProjectionStore = create<ProjectionStoreState>()(
  subscribeWithSelector((set) => ({
    base: null,
    overlay: "none",
    logoUrl: null,
    presentationOpen: false,
    pptSlide: 1,
    pptTotal: 0,
    setBase: (base) => set({ base }),
    setOverlay: (overlay) => set({ overlay }),
    setLogoUrl: (logoUrl) => set({ logoUrl }),
    setPresentationOpen: (presentationOpen) => set({ presentationOpen }),
    setPptSlide: (pptSlide) => set({ pptSlide }),
    setPptTotal: (pptTotal) => set({ pptTotal }),
  })),
);

/**
 * The single function that replaces the legacy `restorePrevious()`
 * (app.js:408-418). There is no "restore" step anymore: `base` already IS the
 * last thing chosen, so leaving black/logo is just `overlay = 'none'` and this
 * selector recomputes. The switch below is exhaustive — TypeScript refuses to
 * compile if a new BaseContent variant is added and not handled here, unlike
 * the old hardcoded priority list that silently fell through to the logo.
 */
export function selectOutput(state: ProjectionStoreState): ProjectionOutput {
  if (state.overlay === "black") return { kind: "black" };
  if (state.overlay === "logo") return { kind: "logo", url: state.logoUrl ?? LOGO_URL };
  if (state.base === null) return { kind: "logo", url: state.logoUrl ?? LOGO_URL };

  switch (state.base.kind) {
    case "ppt":
      return { kind: "ppt" };
    case "video":
      return { kind: "video", url: assetUrl(state.base.assetId), epoch: state.base.epoch };
    case "image":
      return { kind: "image", url: assetUrl(state.base.assetId) };
    case "bible":
      return { kind: "bible", text: state.base.text, reference: state.base.reference };
    case "text":
      return { kind: "text", body: state.base.body };
  }
}
