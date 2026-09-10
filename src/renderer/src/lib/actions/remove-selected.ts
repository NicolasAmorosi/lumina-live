import { useLibraryStore } from "@renderer/stores/library.store";
import { useProgramStore } from "@renderer/stores/program.store";
import { removeAsset } from "./remove-asset";

/** Delete/Backspace target, same priority as the legacy app: a library
 *  selection wins over a playlist selection. */
export function removeSelected(): void {
  const library = useLibraryStore.getState();
  if (library.selectedId !== null) {
    void removeAsset(library.selectedId);
    return;
  }
  const program = useProgramStore.getState();
  if (program.selectedIndex !== null) program.removeAt(program.selectedIndex);
}
