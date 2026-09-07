import { create } from "zustand";
import { api } from "@renderer/lib/api";
import type { DeckDTO, DeckEnvironment, DeckProgress, DeckStatus } from "@shared/types/deck";

export type DeckEntry = {
  status: DeckStatus;
  progress: { done: number; total: number };
  deck: DeckDTO | null;
  error: string | null;
};

type DeckStoreState = {
  byAssetId: Record<number, DeckEntry>;
  environment: DeckEnvironment | null;

  loadEnvironment: () => Promise<void>;
  locateSoffice: () => Promise<void>;
  /** Cache-only peek — never starts a conversion, so listing a playlist can't
   *  kick off work by accident. */
  peek: (assetId: number) => Promise<DeckDTO | null>;
  ensure: (assetId: number, force?: boolean) => Promise<DeckDTO | null>;
  applyProgress: (progress: DeckProgress) => void;
  markStale: (assetId: number) => void;
};

/** In-flight ensure() calls, so the preview effect and "EN VIVO" firing within
 *  milliseconds of each other share one request (main dedupes too, but this
 *  keeps the store from thrashing). */
const pending = new Map<number, Promise<DeckDTO | null>>();

function entryFor(deck: DeckDTO): DeckEntry {
  return {
    status: deck.status,
    progress: { done: deck.slideCount, total: deck.slideCount },
    deck,
    error: deck.error,
  };
}

export const useDeckStore = create<DeckStoreState>((set, get) => ({
  byAssetId: {},
  environment: null,

  loadEnvironment: async () => {
    set({ environment: await api.deck.environment() });
  },

  locateSoffice: async () => {
    set({ environment: await api.deck.locateSoffice() });
  },

  peek: async (assetId) => {
    const deck = await api.deck.get(assetId);
    if (deck) set((s) => ({ byAssetId: { ...s.byAssetId, [assetId]: entryFor(deck) } }));
    return deck;
  },

  ensure: async (assetId, force = false) => {
    const existing = pending.get(assetId);
    if (existing && !force) return existing;

    set((s) => ({
      byAssetId: {
        ...s.byAssetId,
        [assetId]: {
          status: "converting",
          progress: s.byAssetId[assetId]?.progress ?? { done: 0, total: 0 },
          deck: s.byAssetId[assetId]?.deck ?? null,
          error: null,
        },
      },
    }));

    const request = api.deck
      .ensure(assetId, force)
      .then((deck) => {
        set((s) => ({ byAssetId: { ...s.byAssetId, [assetId]: entryFor(deck) } }));
        return deck;
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        set((s) => ({
          byAssetId: {
            ...s.byAssetId,
            [assetId]: {
              status: "failed",
              progress: { done: 0, total: 0 },
              deck: s.byAssetId[assetId]?.deck ?? null,
              error: message,
            },
          },
        }));
        return null;
      })
      .finally(() => {
        pending.delete(assetId);
      });

    pending.set(assetId, request);
    return request;
  },

  applyProgress: (progress) => {
    const current = get().byAssetId[progress.assetId];
    // A "ready" push arrives before ensure() resolves; don't clobber the DTO
    // the resolved promise is about to write.
    set((s) => ({
      byAssetId: {
        ...s.byAssetId,
        [progress.assetId]: {
          status: progress.status,
          progress: { done: progress.done, total: progress.total },
          deck: current?.deck ?? null,
          error: progress.error,
        },
      },
    }));
  },

  markStale: (assetId) =>
    set((s) => {
      const current = s.byAssetId[assetId];
      if (!current) return s;
      return { byAssetId: { ...s.byAssetId, [assetId]: { ...current, status: "stale" } } };
    }),
}));
