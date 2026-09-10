import { api } from "@renderer/lib/api";
import { IpcError } from "@shared/ipc/result";
import { forgetMediaAsset } from "@renderer/lib/hooks/use-media-asset";
import { useAudioStore } from "@renderer/stores/audio.store";
import { useLibraryStore } from "@renderer/stores/library.store";
import { usePreviewStore } from "@renderer/stores/preview.store";
import { useProjectionStore } from "@renderer/stores/projection.store";
import { useProgramStore } from "@renderer/stores/program.store";
import { clearBaseContent } from "./playback";
import { clearPreview } from "./preview";

/**
 * A deleted asset can be referenced by five independent stores (the open
 * schedule, what's on the projector, the preview target, a live audio track,
 * and the id->MediaAsset cache behind schedule-row labels) — none of which
 * `library:remove` itself knows about. This runs after ANY successful
 * delete, forced or not, so nothing keeps pointing at a row that's gone.
 */
function purgeAsset(id: number): void {
  useProgramStore.getState().removeByMediaAsset(id);

  const base = useProjectionStore.getState().base;
  if (base && "assetId" in base && base.assetId === id) clearBaseContent();

  const target = usePreviewStore.getState().target;
  if (target?.kind === "asset" && target.assetId === id) clearPreview();

  for (const track of useAudioStore.getState().tracks) {
    if (track.assetId === id) useAudioStore.getState().removeTrack(track.trackId);
  }

  forgetMediaAsset(id);
}

/** The library "remove" button and the Delete/Backspace shortcut both call
 *  this. Success cleans up every stale reference; a `MEDIA_ASSET_IN_USE`
 *  rejection surfaces as `blockedAssetId`, which `MediaBrowser` turns into a
 *  toast, instead of being thrown — any other error still propagates. */
export async function removeAsset(id: number): Promise<void> {
  try {
    await api.library.remove(id);
    useLibraryStore.getState().dismissBlocked();
  } catch (error) {
    if (error instanceof IpcError && error.code === "MEDIA_ASSET_IN_USE") {
      useLibraryStore.getState().setBlockedAssetId(id);
      return;
    }
    throw error;
  }
  purgeAsset(id);
  await useLibraryStore.getState().refresh(useLibraryStore.getState().activeTab);
  useLibraryStore.getState().select(null);
}

/** The "Eliminar igualmente" escape hatch — same cleanup as `removeAsset`,
 *  but bypasses the in-use guard by also deleting the referencing
 *  `program_items` (main-side, in one transaction — see
 *  `main/services/media-asset-removal.ts`). */
export async function forceRemoveAsset(id: number): Promise<void> {
  await api.library.remove(id, true);
  purgeAsset(id);
  await useLibraryStore.getState().refresh(useLibraryStore.getState().activeTab);
  useLibraryStore.getState().select(null);
}
