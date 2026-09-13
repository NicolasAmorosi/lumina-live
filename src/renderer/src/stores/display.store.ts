import { create } from "zustand";
import { api } from "@renderer/lib/api";
import { useProjectionStore } from "@renderer/stores/projection.store";
import { claimLiveIntent } from "@renderer/lib/actions/live-intent";
import { useSettingsStore } from "@renderer/stores/settings.store";
import type { DisplayInfo } from "@shared/types/display";

type DisplayStoreState = {
  displays: DisplayInfo[];
  displayId: number | null;
  loaded: boolean;

  /** Lists the available screens and resolves which one to target: the
   *  persisted `projection.displayId` setting when it still points at a
   *  connected display, otherwise the first non-primary screen — the
   *  projector, in every real setup. */
  load: () => Promise<void>;
  setDisplayId: (id: number) => Promise<void>;
  /** Opens the projection window on the resolved display and immediately
   *  cuts it to NEGRO — a projector that just connected mid-service must
   *  never flash whatever was last on screen. Used only for the explicit
   *  "Abrir Pantalla" control in Settings. */
  open: () => Promise<void>;
  /** Opens the projection window on demand, on whatever is about to be shown
   *  (NEGRO/LOGO/EN VIVO), without forcing NEGRO first — a no-op once it's
   *  already open. This is what lets the app start with nothing projected at
   *  all: no window opens on launch, the operator's first tap on NEGRO, LOGO
   *  or EN VIVO is what turns the projector on. */
  openIfNeeded: () => Promise<void>;
  close: () => Promise<void>;
};

export const useDisplayStore = create<DisplayStoreState>((set, get) => ({
  displays: [],
  displayId: null,
  loaded: false,

  load: async () => {
    const [displays, settings] = await Promise.all([
      api.displays.list(),
      useSettingsStore.getState().loaded ? Promise.resolve(useSettingsStore.getState().settings) : api.settings.get(),
    ]);
    const persisted = settings["projection.displayId"];
    const resolved = displays.find((d) => d.id === persisted) ?? displays.find((d) => !d.primary) ?? displays[0];
    set({ displays, displayId: resolved?.id ?? null, loaded: true });
  },

  setDisplayId: async (id) => {
    set({ displayId: id });
    await useSettingsStore.getState().update({ "projection.displayId": id });
    // Moving the projector IS what picking a screen means. Nothing else in the
    // renderer reacts to `displayId`, so without this the window stayed on the
    // old display while the Select looked like it had done something — with no
    // hint that the fix was to close and reopen the window from the row below.
    // `projection:open` already closes the existing window and recreates it on
    // the chosen display, and the new one repaints itself from
    // `projection:getSnapshot`.
    if (useProjectionStore.getState().presentationOpen) await api.projection.open(id);
  },

  open: async () => {
    const { displayId } = get();
    if (displayId === null) return;
    await api.projection.open(displayId);
    // Opening onto NEGRO changes what the projector shows, so it claims an
    // intent like every other such action — otherwise a deck still converting
    // would lift the black the moment it finished. See `live-intent.ts`.
    claimLiveIntent();
    useProjectionStore.getState().setOverlay("black");
    useProjectionStore.getState().setPresentationOpen(true);
  },

  openIfNeeded: async () => {
    if (useProjectionStore.getState().presentationOpen) return;
    const { displayId } = get();
    if (displayId === null) return;
    await api.projection.open(displayId);
    useProjectionStore.getState().setPresentationOpen(true);
  },

  close: async () => {
    await api.projection.close();
    useProjectionStore.getState().setPresentationOpen(false);
  },
}));
