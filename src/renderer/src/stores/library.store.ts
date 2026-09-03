import { create } from "zustand";
import type { AssetKind } from "@shared/constants";
import type { MediaAsset } from "@shared/types/media";
import { api } from "@renderer/lib/api";

type LibraryStoreState = {
  activeTab: AssetKind;
  byKind: Record<AssetKind, MediaAsset[]>;
  selectedId: number | null;
  setActiveTab: (tab: AssetKind) => void;
  refresh: (kind: AssetKind) => Promise<void>;
  addFiles: (paths: string[], kind: AssetKind) => Promise<void>;
  remove: (id: number) => Promise<void>;
  select: (id: number | null) => void;
};

export const useLibraryStore = create<LibraryStoreState>((set, get) => ({
  activeTab: "video",
  byKind: { video: [], image: [], audio: [], ppt: [] },
  selectedId: null,

  setActiveTab: (activeTab) => set({ activeTab, selectedId: null }),

  refresh: async (kind) => {
    const assets = await api.library.list(kind);
    set({ byKind: { ...get().byKind, [kind]: assets } });
  },

  addFiles: async (paths, kind) => {
    await api.library.add(paths, kind);
    await get().refresh(kind);
  },

  remove: async (id) => {
    await api.library.remove(id);
    await get().refresh(get().activeTab);
  },

  select: (selectedId) => set({ selectedId }),
}));
