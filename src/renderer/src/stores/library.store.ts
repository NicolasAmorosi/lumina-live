import { create } from "zustand";
import { ASSET_KINDS, type AssetKind } from "@shared/constants";
import type { MediaAsset } from "@shared/types/media";
import { api } from "@renderer/lib/api";

/** A resource tab's source view: either the added-to-library list, or one of
 *  its linked folders (see `settings["library.linkedFolders"]`), addressed
 *  by its absolute path. */
export type MediaSourceView = "recent" | string;

export function folderAssetsKey(kind: AssetKind, folderPath: string): string {
  return `${kind}::${folderPath}`;
}

type LibraryStoreState = {
  activeTab: AssetKind;
  byKind: Record<AssetKind, MediaAsset[]>;
  activeView: Record<AssetKind, MediaSourceView>;
  folderAssets: Record<string, MediaAsset[]>;
  selectedId: number | null;
  /** Set (to the asset's id) when a delete fails because it's still used by a
   *  saved program (`MEDIA_ASSET_IN_USE`, handled in `lib/actions/remove-asset.ts`)
   *  — cleared on the next selection change, or explicitly via `dismissBlocked`. */
  blockedAssetId: number | null;
  setActiveTab: (tab: AssetKind) => void;
  refresh: (kind: AssetKind) => Promise<void>;
  addFiles: (paths: string[], kind: AssetKind) => Promise<void>;
  setBlockedAssetId: (id: number | null) => void;
  dismissBlocked: () => void;
  select: (id: number | null) => void;
  setActiveView: (kind: AssetKind, view: MediaSourceView) => void;
  refreshFolder: (kind: AssetKind, folderPath: string) => Promise<void>;
  /** Restores each kind's last-selected view from settings on launch,
   *  dropping a persisted folder that was unlinked (or never existed)
   *  since — that path no longer has a button to select in the bar. */
  hydrateActiveViews: (
    persisted: Record<AssetKind, string>,
    linkedFolders: Record<AssetKind, string[]>,
  ) => void;
};

export const useLibraryStore = create<LibraryStoreState>((set, get) => ({
  activeTab: "video",
  byKind: { video: [], image: [], audio: [], ppt: [] },
  activeView: { video: "recent", image: "recent", audio: "recent", ppt: "recent" },
  folderAssets: {},
  selectedId: null,
  blockedAssetId: null,

  setActiveTab: (activeTab) => set({ activeTab, selectedId: null, blockedAssetId: null }),

  refresh: async (kind) => {
    const assets = await api.library.list(kind);
    set({ byKind: { ...get().byKind, [kind]: assets } });
  },

  addFiles: async (paths, kind) => {
    await api.library.add(paths, kind);
    await get().refresh(kind);
  },

  setBlockedAssetId: (blockedAssetId) => set({ blockedAssetId }),
  dismissBlocked: () => set({ blockedAssetId: null }),

  select: (selectedId) => set({ selectedId, blockedAssetId: null }),

  setActiveView: (kind, view) =>
    set((state) => ({ activeView: { ...state.activeView, [kind]: view }, selectedId: null })),

  refreshFolder: async (kind, folderPath) => {
    const assets = await api.library.listFolder(kind, folderPath);
    set((state) => ({
      folderAssets: { ...state.folderAssets, [folderAssetsKey(kind, folderPath)]: assets },
    }));
  },

  hydrateActiveViews: (persisted, linkedFolders) =>
    set((state) => {
      const activeView = { ...state.activeView };
      for (const kind of ASSET_KINDS) {
        const saved = persisted[kind];
        activeView[kind] = saved === "recent" || linkedFolders[kind].includes(saved) ? saved : "recent";
      }
      return { activeView };
    }),
}));
