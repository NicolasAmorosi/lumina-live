import { onIpc } from "@renderer/lib/ipc";
import { useLibraryStore } from "@renderer/stores/library.store";

/**
 * Keeps the library in sync with changes this window didn't cause itself —
 * the background missing-file sweep (`library-sweeper.ts`), a relocate, or
 * the tail end of a large `library:add`/`library:listFolder` import.
 * `addFiles` already refreshes its own kind right after `await`ing, so this
 * is a safety net for everything else, not the primary refresh path.
 */
export function startLibrarySyncEffects(): () => void {
  // `library-changed` only ever means "something outside this window's own
  // `addFiles`/`refresh` calls mutated the library" (a relocate, the missing-
  // file sweep, another window's drag&drop) — never "a `list*` read just
  // ran". Refreshing the active folder view here used to be exactly what fed
  // `library:listFolder` back into itself: that read broadcast this same
  // event, which re-ran the read, forever. `library:listFolder` no longer
  // broadcasts (see `library-import.ts`), so this handler staying "dumb" is
  // now safe — but the fix that actually matters is there, not here.
  const unsubscribeChanged = onIpc("library-changed", ({ kind }) => {
    const { activeView } = useLibraryStore.getState();
    void useLibraryStore.getState().refresh(kind);
    const view = activeView[kind];
    if (view !== "recent") void useLibraryStore.getState().refreshFolder(kind, view);
  });

  const unsubscribeImportProgress = onIpc("library-import-progress", (progress) => {
    if (progress.status === "done") useLibraryStore.getState().clearImportProgress();
    else useLibraryStore.getState().applyImportProgress(progress);
  });

  return () => {
    unsubscribeChanged();
    unsubscribeImportProgress();
  };
}
