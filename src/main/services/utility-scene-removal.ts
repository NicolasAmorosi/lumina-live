import { getDbHandle, getProgramsRepo, getUtilityRepo } from "./repos";

/**
 * Deleting a time scene crosses two repositories — `program_items` (the FK
 * that blocks the delete) and `utility_scenes` itself — so it lives here
 * rather than in either repo, exactly like `media-asset-removal.ts`.
 *
 * Without `force`, this is just `UtilityRepo.delete()`, which throws
 * `IpcError("UTILITY_SCENE_IN_USE")` when a saved program still references the
 * scene. With `force`, the referencing items are deleted first, in the SAME
 * transaction as the scene, so a failure can never leave a program missing a
 * row while the scene it pointed at survives.
 *
 * Nothing here touches the projector: `base` holds a resolved COPY of the
 * scene (see `BaseContent`'s `utility` variant), so a countdown that is live
 * keeps counting for the congregation. That is the control window's call, and
 * main has no business making it — see
 * `.claude/knowledge/main-cannot-know-what-is-live-under-an-overlay.md`.
 */
export function removeUtilityScene(id: number, force: boolean): void {
  if (!force) {
    getUtilityRepo().delete(id);
    return;
  }

  const { sqlite } = getDbHandle();
  sqlite.transaction(() => {
    getProgramsRepo().deleteItemsByUtilityScene(id);
    getUtilityRepo().delete(id);
  })();
}
