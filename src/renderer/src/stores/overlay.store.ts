import { create } from "zustand";
import type { Plate } from "@shared/types/overlay";

/**
 * The mirror of `overlay_plates`.
 *
 * Which plate is SELECTED is the preview target's (`{ kind: "plate" }`), like
 * every other list in the app; what is on the air lives in
 * `projection.store.livePlates`, because it is an input of `selectOutput`.
 */
type OverlayStoreState = {
  plates: Plate[];
  setPlates: (plates: Plate[]) => void;
};

export const useOverlayStore = create<OverlayStoreState>()((set) => ({
  plates: [],
  setPlates: (plates) => set({ plates }),
}));

export function findPlate(plates: readonly Plate[], id: number | null): Plate | null {
  return id === null ? null : (plates.find((plate) => plate.id === id) ?? null);
}
