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

  /**
   * Merges first, then persists.
   *
   * It used to await the write and merge afterwards, against a snapshot taken
   * before the await. Two settings changed at once — adding a folder to
   * `video` while removing one from `image`, which is a single drag away in
   * the media source bar — each merged into the state as it was *before* the
   * other landed, so whichever resolved second silently threw the first away.
   * Merging synchronously also makes the toggles in Settings behave the way
   * they already appear to: immediately.
   */
  update: async (partial) => {
    set({ settings: { ...get().settings, ...partial } });
    if (partial["ui.theme"]) document.documentElement.dataset["theme"] = partial["ui.theme"];

    try {
      await api.settings.set(partial);
    } catch (error) {
      // The optimistic state is now a lie, and unpicking exactly which keys
      // this call owned would be wrong anyway — another update may have landed
      // in between. Main is the source of truth, so re-read from it.
      await get()
        .load()
        .catch(() => undefined);
      throw error;
    }
  },
}));
