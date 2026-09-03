import { create } from "zustand";
import type { ServiceDTO, ServiceItemDTO, ServiceItemUpsert } from "@shared/types/service";

type ServiceStoreState = {
  currentServiceId: number | null;
  currentServiceName: string;
  items: ServiceItemDTO[];
  selectedIndex: number | null;
  activeIndex: number | null;

  loadService: (service: ServiceDTO) => void;
  newPlaylist: () => void;
  addItem: (item: ServiceItemUpsert) => void;
  removeAt: (index: number) => void;
  moveUp: (index: number) => void;
  moveDown: (index: number) => void;
  reorder: (from: number, to: number) => void;
  clear: () => void;
  select: (index: number | null) => void;
  setActive: (index: number | null) => void;
};

function reindex(items: ServiceItemDTO[]): ServiceItemDTO[] {
  return items.map((item, position) => ({ ...item, position }));
}

export const useServiceStore = create<ServiceStoreState>((set, get) => ({
  currentServiceId: null,
  currentServiceName: "Nuevo culto",
  items: [],
  selectedIndex: null,
  activeIndex: null,

  loadService: (service) =>
    set({
      currentServiceId: service.id,
      currentServiceName: service.name,
      items: service.items,
      selectedIndex: null,
      activeIndex: null,
    }),

  newPlaylist: () =>
    set({
      currentServiceId: null,
      currentServiceName: "Nuevo culto",
      items: [],
      selectedIndex: null,
      activeIndex: null,
    }),

  addItem: (item) =>
    set((state) => ({
      // Negative ids mark not-yet-persisted rows; ServicesRepo.save() rewrites
      // everything from `position` 0 anyway, so the id only needs to be a
      // stable, unique React key until the service is saved.
      items: reindex([...state.items, { ...item, id: -(state.items.length + 1) } as ServiceItemDTO]),
    })),

  removeAt: (index) =>
    set((state) => {
      const items = reindex(state.items.filter((_, i) => i !== index));
      const selectedIndex = state.selectedIndex === index ? null : state.selectedIndex;
      return { items, selectedIndex };
    }),

  moveUp: (index) => {
    if (index <= 0) return;
    const items = [...get().items];
    const [prev, current] = [items[index - 1]!, items[index]!];
    items[index - 1] = current;
    items[index] = prev;
    set({ items: reindex(items), selectedIndex: index - 1 });
  },

  moveDown: (index) => {
    const items = [...get().items];
    if (index >= items.length - 1) return;
    const [current, next] = [items[index]!, items[index + 1]!];
    items[index] = next;
    items[index + 1] = current;
    set({ items: reindex(items), selectedIndex: index + 1 });
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
    set({ items: reindex(items), selectedIndex: insertAt });
  },

  clear: () => set({ items: [], selectedIndex: null, activeIndex: null }),
  select: (selectedIndex) => set({ selectedIndex }),
  setActive: (activeIndex) => set({ activeIndex }),
}));
