import { useLibraryStore } from "@renderer/stores/library.store";
import { useServiceStore } from "@renderer/stores/service.store";

/** Delete/Backspace target, same priority as the legacy app: a library
 *  selection wins over a playlist selection. */
export function removeSelected(): void {
  const library = useLibraryStore.getState();
  if (library.selectedId !== null) {
    void library.remove(library.selectedId);
    return;
  }
  const service = useServiceStore.getState();
  if (service.selectedIndex !== null) service.removeAt(service.selectedIndex);
}
