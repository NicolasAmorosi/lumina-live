import { api } from "@renderer/lib/api";
import { t } from "@renderer/lib/i18n/i18n-provider";
import { toast } from "@renderer/lib/toast";
import { useProgramStore } from "@renderer/stores/program.store";
import type { ProgramSummary } from "@shared/types/program";

export type ProgramMetaInput = {
  name: string;
  notes: string | null;
  favorite: boolean;
};

/** True when loading a different program, starting a new one, or deleting the
 *  one that's currently open would throw away work — the guard callers (the
 *  modal's `discard` panel, or the TopBar's "Nuevo programa" toast) check
 *  before calling `openProgram`/`newProgram`/`deleteProgram` unconditionally. */
export function hasUnsavedChanges(): boolean {
  const { dirty, items } = useProgramStore.getState();
  return dirty && items.length > 0;
}

function draftItems() {
  return useProgramStore
    .getState()
    .items.map(({ id: _id, position: _position, ...rest }) => rest as never);
}

/** Overwrites the currently loaded program with the schedule as it stands —
 *  requires a program to already be loaded (see `createProgramFromCurrent`
 *  for a brand new one). Re-hydrates the store from the saved row afterwards
 *  so item ids and `dirty` reflect what's actually on disk. */
export async function saveCurrentProgram(): Promise<void> {
  const { currentProgramId, currentProgramName, currentProgramNotes } = useProgramStore.getState();
  if (currentProgramId === null) return;
  try {
    const summary = await api.programs.save({
      id: currentProgramId,
      name: currentProgramName,
      notes: currentProgramNotes,
      // `favorite` is intentionally omitted — this store never tracks it, and
      // ProgramsRepo.save() only writes the field when it's actually present,
      // so the star set from the programs modal survives a quick save.
      items: draftItems(),
    });
    const full = await api.programs.load(summary.id);
    useProgramStore.getState().loadProgram(full);
    toast.success(t("programs.saved", { name: summary.name }));
  } catch {
    toast.danger(t("programs.saveError"));
  }
}

/** Creates a new saved program from the schedule currently open — used by the
 *  side panel's `create` mode, whether that's the very first save of a new
 *  program or an explicit "Guardar como" off an already-saved one. */
export async function createProgramFromCurrent(meta: ProgramMetaInput): Promise<ProgramSummary | null> {
  try {
    const summary = await api.programs.save({ ...meta, items: draftItems() });
    const full = await api.programs.load(summary.id);
    useProgramStore.getState().loadProgram(full);
    toast.success(t("programs.saved", { name: summary.name }));
    return summary;
  } catch {
    toast.danger(t("programs.createError"));
    return null;
  }
}

/** Creates a brand new, empty program — used by the programs list's "+"
 *  button, independent of whatever schedule happens to be open. Loads it into
 *  the schedule only when `openAfter` is true; the caller is responsible for
 *  checking `hasUnsavedChanges()` first when it intends to pass `true`. */
export async function createProgram(meta: ProgramMetaInput, openAfter: boolean): Promise<ProgramSummary | null> {
  try {
    const summary = await api.programs.save({ ...meta, items: [] });
    if (openAfter) {
      const full = await api.programs.load(summary.id);
      useProgramStore.getState().loadProgram(full);
    }
    toast.success(t("programs.saved", { name: summary.name }));
    return summary;
  } catch {
    toast.danger(t("programs.createError"));
    return null;
  }
}

/** Renames/edits a program's metadata without touching its items or loading
 *  it — works on any saved program, not just the one currently open. */
export async function updateProgramMeta(id: number, meta: ProgramMetaInput): Promise<ProgramSummary | null> {
  try {
    const summary = await api.programs.updateMeta({ id, ...meta });
    if (id === useProgramStore.getState().currentProgramId) {
      useProgramStore.getState().setProgramMeta(meta);
    }
    toast.success(t("programs.updated", { name: summary.name }));
    return summary;
  } catch {
    toast.danger(t("programs.updateError"));
    return null;
  }
}

/** Copies a program's header + items under the given metadata — chosen by the
 *  user in the side panel's `duplicate` mode, prefilled with a "(copia)"
 *  name suggestion and the source's own notes/favorite. Never touches the
 *  currently loaded program. */
export async function duplicateProgram(id: number, meta: ProgramMetaInput): Promise<ProgramSummary | null> {
  try {
    const summary = await api.programs.duplicate({ id, ...meta });
    toast.success(t("programs.saved", { name: summary.name }));
    return summary;
  } catch {
    toast.danger(t("programs.duplicateError"));
    return null;
  }
}

/** Flips a saved program's favorite flag from the programs list — no success
 *  toast, since the star itself is the feedback; only a failure needs one. */
export async function setProgramFavorite(id: number, favorite: boolean): Promise<ProgramSummary | null> {
  try {
    return await api.programs.setFavorite({ id, favorite });
  } catch {
    toast.danger(t("programs.favoriteError"));
    return null;
  }
}

/** Persists the manual list order after a drag. `ids` is the whole list in
 *  its new order; the returned list is what actually got stored, so the caller
 *  can replace its optimistic state with it (or `null` on failure, meaning the
 *  caller should re-read the list rather than keep a lie on screen). */
export async function reorderPrograms(ids: number[]): Promise<ProgramSummary[] | null> {
  try {
    return await api.programs.reorder(ids);
  } catch {
    toast.danger(t("programs.reorderError"));
    return null;
  }
}

/** Loads a saved program into the schedule. Callers must check
 *  `hasUnsavedChanges()` first — this never asks on its own. */
export async function openProgram(id: number): Promise<void> {
  try {
    const full = await api.programs.load(id);
    useProgramStore.getState().loadProgram(full);
  } catch {
    toast.danger(t("programs.loadError"));
  }
}

/** Deletes a saved program. If it was the one currently open, the schedule
 *  resets to a new, unsaved program instead of pointing at a row that no
 *  longer exists. */
export async function deleteProgram(id: number): Promise<void> {
  try {
    const wasCurrent = id === useProgramStore.getState().currentProgramId;
    await api.programs.delete(id);
    if (wasCurrent) useProgramStore.getState().newProgram();
    toast.success(t("programs.deleted"));
  } catch {
    toast.danger(t("programs.deleteError"));
  }
}

/** Starts a brand new, unsaved program. Callers must check
 *  `hasUnsavedChanges()` first — this never asks on its own. */
export function newProgram(): void {
  useProgramStore.getState().newProgram();
}
