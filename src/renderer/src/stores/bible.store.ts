import { create } from "zustand";
import type { BibleBookDTO, BibleVerseDTO, BibleVersionDTO } from "@shared/types/bible";
import { api } from "@renderer/lib/api";

type BibleStoreState = {
  versions: BibleVersionDTO[];
  books: BibleBookDTO[];
  versionId: number | null;
  bookId: number | null;
  chapter: number | null;
  verses: BibleVerseDTO[];
  currentVerseIndex: number | null;

  loadVersions: () => Promise<void>;
  setVersion: (versionId: number) => Promise<void>;
  setBookAndChapter: (bookId: number, chapter: number) => Promise<void>;
  setCurrentVerseIndex: (index: number | null) => void;
};

export const useBibleStore = create<BibleStoreState>((set, get) => ({
  versions: [],
  books: [],
  versionId: null,
  bookId: null,
  chapter: null,
  verses: [],
  currentVerseIndex: null,

  loadVersions: async () => {
    const versions = await api.bible.versions();
    set({ versions });
    if (versions[0]) await get().setVersion(versions[0].id);
  },

  setVersion: async (versionId) => {
    const books = await api.bible.books(versionId);
    set({ versionId, books, bookId: null, chapter: null, verses: [], currentVerseIndex: null });
  },

  setBookAndChapter: async (bookId, chapter) => {
    const verses = await api.bible.chapter(bookId, chapter);
    set({ bookId, chapter, verses, currentVerseIndex: null });
  },

  setCurrentVerseIndex: (currentVerseIndex) => set({ currentVerseIndex }),
}));
