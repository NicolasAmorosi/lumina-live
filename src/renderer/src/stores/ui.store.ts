import { create } from "zustand";

/**
 * App-level chrome that something outside React has to be able to open.
 *
 * Modal visibility normally belongs in `App.tsx`'s own state, and `programsOpen`
 * still lives there. Settings is the exception: a toast raised from
 * `display.store` when there is no screen to project on offers "Choose
 * screen", and a toast action is a plain function with no component tree
 * under it. Routing just that one flag through a store is what lets the offer
 * actually land on Settings -> Screen instead of only naming it.
 */
type UiStoreState = {
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
  /** The asset whose "remove anyway" confirmation is open, `null` when
   *  none. Here for the same reason as `settingsOpen`: the offer is a toast
   *  action raised from `lib/actions/remove-asset.ts`, with no component tree
   *  under it. Global also means the dialog can be rendered ONCE, in `App`,
   *  rather than by every mounted `MediaBrowser` — see `F1`. */
  removeAssetConfirmId: number | null;
  setRemoveAssetConfirmId: (id: number | null) => void;
  /** "Close anyway?" — raised from `effects/draft-autosave.ts` when main
   *  asks whether the window may close, which again is not a component's
   *  question to ask. `null` when closed; otherwise why it is asking. */
  closeGuard: CloseGuardReasons | null;
  setCloseGuard: (reasons: CloseGuardReasons | null) => void;
};

/** Why closing needs a confirmation: work that is not saved, and/or something
 *  the congregation is looking at right now. */
export type CloseGuardReasons = { unsaved: boolean; onAir: boolean };

export const useUiStore = create<UiStoreState>((set) => ({
  settingsOpen: false,
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  removeAssetConfirmId: null,
  setRemoveAssetConfirmId: (removeAssetConfirmId) => set({ removeAssetConfirmId }),
  closeGuard: null,
  setCloseGuard: (closeGuard) => set({ closeGuard }),
}));
