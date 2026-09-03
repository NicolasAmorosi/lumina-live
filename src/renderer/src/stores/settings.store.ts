import { create } from "zustand";
import { DEFAULT_SETTINGS, type SettingsMap } from "@shared/types/settings";
import { api } from "@renderer/lib/api";

type SettingsStoreState = {
  settings: SettingsMap;
  loaded: boolean;
  load: () => Promise<void>;
  update: (partial: Partial<SettingsMap>) => Promise<void>;
};

export const useSettingsStore = create<SettingsStoreState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,

  load: async () => {
    const settings = await api.settings.get();
    set({ settings, loaded: true });
    document.documentElement.dataset["theme"] = settings["ui.theme"];
  },

  update: async (partial) => {
    await api.settings.set(partial);
    const settings = { ...get().settings, ...partial };
    set({ settings });
    if (partial["ui.theme"]) document.documentElement.dataset["theme"] = partial["ui.theme"];
  },
}));
