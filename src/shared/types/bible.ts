export type BibleVersionDTO = {
  id: number;
  code: string;
  name: string;
  language: string;
  isBuiltin: boolean;
  verseCount: number;
};

export type BibleBookDTO = {
  id: number;
  versionId: number;
  position: number;
  abbrev: string;
  name: string;
  testament: "OT" | "NT";
  chapterCount: number;
};

export type BibleVerseDTO = {
  id: number;
  bookId: number;
  bookName: string;
  chapter: number;
  verse: number;
  text: string;
};

export type BibleSearchHit = BibleVerseDTO & {
  snippet: string;
};

export type BibleFavorite = {
  id: number;
  versionId: number;
  bookId: number;
  chapter: number;
  verseFrom: number;
  verseTo: number;
  reference: string;
  label: string | null;
  createdAt: number;
};

/** Raw shape of the bundled/importable Bible JSON files. */
export type BibleSourceBook = {
  abbrev: string;
  name?: string;
  nombre?: string;
  chapters: unknown;
};
