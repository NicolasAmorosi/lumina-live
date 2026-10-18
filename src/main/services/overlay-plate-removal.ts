import { getDbHandle, getOverlaysRepo, getProgramsRepo } from "./repos";

/**
 * `utility-scene-removal.ts` for a plate: without `force`, the FK refuses a
 * plate a saved program uses (`OVERLAY_PLATE_IN_USE`); with it, the program
 * rows go first, in the same transaction as the plate.
 *
 * Whether the plate is UP is the control window's business, not main's — it
 * takes the plate down itself (`deletePlate`).
 */
export function removeOverlayPlate(id: number, force: boolean): void {
  if (!force) {
    getOverlaysRepo().delete(id);
    return;
  }

  const { sqlite } = getDbHandle();
  sqlite.transaction(() => {
    getProgramsRepo().deleteItemsByPlate(id);
    getOverlaysRepo().delete(id);
  })();
}
