import { useServiceStore } from "@renderer/stores/service.store";
import { useProjectionStore } from "@renderer/stores/projection.store";
import { api } from "@renderer/lib/api";
import type { OverlayState } from "@shared/types/projection";

let videoEpoch = 0;

/**
 * Presents the currently selected playlist item — the single implementation
 * behind PreviewPanel's "En vivo" button and the Enter shortcut
 * (use-global-shortcuts.ts), so both stay in sync by construction. Opening
 * the PPT COM session and loading its slide thumbnails is NOT done here: it
 * reacts to `base` becoming `{kind:'ppt'}` in PreviewPanel's own effect,
 * because that UI (slide counter, thumbnail strip) only exists there.
 */
export async function presentSelected(): Promise<void> {
  const { items, selectedIndex, setActive } = useServiceStore.getState();
  if (selectedIndex === null) return;
  const item = items[selectedIndex];
  if (!item) return;

  const { setBase } = useProjectionStore.getState();
  setActive(selectedIndex);

  if (item.kind === "media") {
    const asset = await api.library.get(item.mediaAssetId);
    if (!asset) return;
    if (asset.kind === "video") {
      videoEpoch += 1;
      setBase({ kind: "video", assetId: asset.id, epoch: videoEpoch });
    } else {
      setBase({ kind: "image", assetId: asset.id });
    }
  } else if (item.kind === "ppt") {
    setBase({ kind: "ppt", assetId: item.mediaAssetId });
  } else if (item.kind === "bible") {
    setBase({ kind: "bible", text: item.text, reference: item.reference });
  } else {
    setBase({ kind: "text", body: item.body });
  }
}

/** Advances/retreats the open PPT slideshow by one and keeps the shared
 *  `pptSlide` counter in lockstep — used by PreviewPanel's buttons and the
 *  global ←/→ shortcut. No-op if nothing is presenting a PPT. */
export async function advancePptSlide(direction: 1 | -1): Promise<void> {
  const { base, pptSlide, pptTotal, setPptSlide } = useProjectionStore.getState();
  if (base?.kind !== "ppt") return;
  if (direction === 1) {
    await api.ppt.next();
    setPptSlide(Math.min(pptTotal || pptSlide + 1, pptSlide + 1));
  } else {
    await api.ppt.prev();
    setPptSlide(Math.max(1, pptSlide - 1));
  }
}

/** Toggles NEGRO/LOGO — shared by the footer buttons (App.tsx) and the B/L
 *  shortcuts so there's one definition of "toggle" (press again to clear). */
export function toggleOverlay(kind: Extract<OverlayState, "black" | "logo">): void {
  const { overlay, setOverlay } = useProjectionStore.getState();
  setOverlay(overlay === kind ? "none" : kind);
}
