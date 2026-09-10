import { create } from "zustand";
import type { ProgramDTO, ProgramItemDTO, ProgramItemUpsert } from "@shared/types/program";

type ProgramMeta = {
  name: string;
  notes: string | null;
};

type ProgramStoreState = {
  currentProgramId: number | null;
  currentProgramName: string;
  currentProgramNotes: string | null;
  items: ProgramItemDTO[];
  selectedIndex: number | null;
  activeIndex: number | null;
  /** True once the schedule diverges from what's on disk — new/removed/
   *  reordered items, or a name/notes/date edit, since the last load or save.
   *  Selection/live cursors don't count: they don't change what a save would
   *  persist. */
  dirty: boolean;

  loadProgram: (program: ProgramDTO) => void;
  newProgram: () => void;
  setProgramMeta: (meta: ProgramMeta) => void;
  /** `insertAt` places the item before that position; omitted (or past the end)
   *  appends — the default every non-drop caller wants. */
  addItem: (item: ProgramItemUpsert, insertAt?: number) => void;
  removeAt: (index: number) => void;
  removeByMediaAsset: (assetId: number) => void;
  moveUp: (index: number) => void;
  moveDown: (index: number) => void;
  reorder: (from: number, to: number) => void;
  clear: () => void;
  select: (index: number | null) => void;
  setActive: (index: number | null) => void;
};

function reindex(items: ProgramItemDTO[]): ProgramItemDTO[] {
  return items.map((item, position) => ({ ...item, position }));
}

export const useProgramStore = create<ProgramStoreState>((set, get) => ({
  currentProgramId: null,
  currentProgramName: "",
  currentProgramNotes: null,
  items: [],
  selectedIndex: null,
  activeIndex: null,
  dirty: true,

  loadProgram: (program) =>
    set({
      currentProgramId: program.id,
      currentProgramName: program.name,
      currentProgramNotes: program.notes,
      items: program.items,
      selectedIndex: null,
      activeIndex: null,
      dirty: false,
    }),

  newProgram: () =>
    set({
      currentProgramId: null,
      currentProgramName: "",
      currentProgramNotes: null,
      items: [],
      selectedIndex: null,
      activeIndex: null,
      dirty: true,
    }),

  setProgramMeta: ({ name, notes }) =>
    set({
      currentProgramName: name,
      currentProgramNotes: notes,
      dirty: true,
    }),

  addItem: (item, insertAt) =>
    set((state) => {
      // Negative ids mark not-yet-persisted rows; ProgramsRepo.save() rewrites
      // everything from `position` 0 anyway, so the id only needs to be a
      // stable, unique React key until the program is saved.
      const newItem = { ...item, id: -(state.items.length + 1) } as ProgramItemDTO;
      const items = [...state.items];
      const at = insertAt === undefined ? items.length : Math.min(Math.max(insertAt, 0), items.length);
      items.splice(at, 0, newItem);
      return { items: reindex(items), dirty: true };
    }),

  removeAt: (index) =>
    set((state) => {
      const items = reindex(state.items.filter((_, i) => i !== index));
      const selectedIndex = state.selectedIndex === index ? null : state.selectedIndex;
      return { items, selectedIndex, dirty: true };
    }),

  /** Used when a media/ppt asset is force-deleted from the library: every item
   *  pointing at it must go, wherever it sits in the schedule — unlike
   *  `removeAt`, which only ever removes one row by position and (as a known,
   *  separate bug) doesn't remap `selectedIndex`/`activeIndex` either. This
   *  remaps both cursors to the survivors' new positions instead of just
   *  clearing them, so an unrelated selection doesn't jump to null. */
  removeByMediaAsset: (assetId) =>
    set((state) => {
      const remap = new Map<number, number>();
      const survivors: ProgramItemDTO[] = [];
      state.items.forEach((item, oldIndex) => {
        const isTarget = (item.kind === "media" || item.kind === "ppt") && item.mediaAssetId === assetId;
        if (isTarget) return;
        remap.set(oldIndex, survivors.length);
        survivors.push(item);
      });
      const remapIndex = (index: number | null) => (index === null ? null : (remap.get(index) ?? null));
      return {
        items: reindex(survivors),
        selectedIndex: remapIndex(state.selectedIndex),
        activeIndex: remapIndex(state.activeIndex),
        dirty: true,
      };
    }),

  moveUp: (index) => {
    if (index <= 0) return;
    const items = [...get().items];
    const [prev, current] = [items[index - 1]!, items[index]!];
    items[index - 1] = current;
    items[index] = prev;
    set({ items: reindex(items), selectedIndex: index - 1, dirty: true });
  },

  moveDown: (index) => {
    const items = [...get().items];
    if (index >= items.length - 1) return;
    const [current, next] = [items[index]!, items[index + 1]!];
    items[index] = next;
    items[index + 1] = current;
    set({ items: reindex(items), selectedIndex: index + 1, dirty: true });
  },

  reorder: (from, to) => {
    if (from === to) return;
    const items = [...get().items];
    const moved = items[from];
    if (!moved) return;
    items.splice(from, 1);
    // `to` was computed against the pre-removal array; shift it back by one
    // once the dragged item is spliced out from before that position.
    const insertAt = to > from ? to - 1 : to;
    items.splice(insertAt, 0, moved);
    set({ items: reindex(items), selectedIndex: insertAt, dirty: true });
  },

  clear: () => set({ items: [], selectedIndex: null, activeIndex: null, dirty: true }),
  select: (selectedIndex) => set({ selectedIndex }),
  setActive: (activeIndex) => set({ activeIndex }),
}));
