import { useLibraryStore, type MediaSourceView } from "@renderer/stores/library.store";
import { useSettingsStore } from "@renderer/stores/settings.store";
import { api } from "@renderer/lib/api";
import type { AssetKind } from "@shared/constants";
import type { MediaSortOrder } from "@shared/types/media";

/**
 * Linked folders and the last-picked view both live in settings (durable, one
 * per kind); which one is showing right now also lives in the library store
 * (so the grid updates instantly, without waiting on the settings round-trip).
 * This crosses both stores, so it belongs here rather than in either one.
 */
export function selectMediaSourceView(kind: AssetKind, view: MediaSourceView): void {
  useLibraryStore.getState().setActiveView(kind, view);
  const current = useSettingsStore.getState().settings["library.activeView"];
  void useSettingsStore.getState().update({ "library.activeView": { ...current, [kind]: view } });
}

export async function addLinkedFolder(kind: AssetKind): Promise<void> {
  const chosen = await api.files.pickFolder();
  if (chosen === null) return;

  const current = useSettingsStore.getState().settings["library.linkedFolders"];
  if (!current[kind].includes(chosen)) {
    await useSettingsStore.getState().update({
      "library.linkedFolders": { ...current, [kind]: [...current[kind], chosen] },
    });
  }

  selectMediaSourceView(kind, chosen);
  await useLibraryStore.getState().refreshFolder(kind, chosen);
}

export async function removeLinkedFolder(kind: AssetKind, folderPath: string): Promise<void> {
  const current = useSettingsStore.getState().settings["library.linkedFolders"];
  await useSettingsStore.getState().update({
    "library.linkedFolders": { ...current, [kind]: current[kind].filter((p) => p !== folderPath) },
  });

  if (useLibraryStore.getState().activeView[kind] === folderPath) selectMediaSourceView(kind, "recent");
  // An unlinked folder's listing is dead weight: nothing can select it again,
  // and it was holding a full `MediaAsset[]` (hundreds of entries, for the
  // folders this feature exists for) until the app closed.
  useLibraryStore.getState().forgetFolder(kind, folderPath);
}

/**
 * The remaining per-kind view preference, and the only one that never touches
 * the library store: which files are on screen does not change, just their
 * order, and the grid reads it straight from settings — `update` merges
 * synchronously, so the grid re-sorts on the same tick the menu is clicked.
 */
export function setMediaSortOrder(kind: AssetKind, order: MediaSortOrder): void {
  const current = useSettingsStore.getState().settings["library.sort"];
  void useSettingsStore.getState().update({ "library.sort": { ...current, [kind]: order } });
}
