/**
 * Which screen the projection window belongs on, once the list of screens
 * changes: the one the operator chose (`projection.displayId`) when it is
 * connected, else the first screen that is not the operator's own. Never the
 * primary one — that is the laptop, and a fullscreen, always-on-top window
 * there covers the control window. `null` when there is no such screen.
 *
 * Pure, so the rule is tested without Electron (`tests/main/projector-display-choice.test.ts`).
 */
export function chooseProjectorDisplay(
  displayIds: readonly number[],
  primaryId: number,
  preferredId: number | null,
): number | null {
  if (preferredId !== null && preferredId !== primaryId && displayIds.includes(preferredId)) return preferredId;
  return displayIds.find((id) => id !== primaryId) ?? null;
}
