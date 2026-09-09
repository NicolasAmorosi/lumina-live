import { useLibraryStore, type MediaSourceView } from "@renderer/stores/library.store";
import { useSettingsStore } from "@renderer/stores/settings.store";
import { api } from "@renderer/lib/api";
import type { AssetKind } from "@shared/constants";

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
}
