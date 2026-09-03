import type { BibleSourceBook } from "@shared/types/bible";

export type ParsedVerse = { chapter: number; verse: number; text: string };
export type ParsedBook = {
  abbrev: string;
  name: string;
  testament: "OT" | "NT";
  chapterCount: number;
  verses: ParsedVerse[];
};

/** The 39 Old Testament book abbreviations of the RV1960 bundle, in canonical order. */
const OT_ABBREVS = new Set([
  "gn", "ex", "lv", "nm", "dt", "js", "jud", "rt", "1s", "2s",
  "1r", "2r", "1cr", "2cr", "esd", "neh", "est", "job", "sal", "pr",
  "ec", "cnt", "is", "jer", "lm", "ez", "dn", "os", "jl", "am",
  "abd", "jon", "miq", "nah", "hab", "sof", "hag", "zac", "mal",
]);

/**
 * Defensive parser tolerant of the shapes documented in the legacy
 * `docs/knowledge/05-data-and-persistence.md`: container as array-of-books,
 * `{books:[...]}`, or `{bookName:{...}}`; book name under `name`/`nombre`;
 * chapters as array or `{"1":...}` object; verses as string[], `{text}`[],
 * `{verse}`[], or `{"1": "text"}` object. Anything imported by the user must
 * fall into one of these to project correctly.
 */
export function parseBibleSource(raw: unknown): ParsedBook[] {
  const books = extractBooks(raw);
  return books.map((book, index) => parseBook(book, index));
}

function extractBooks(raw: unknown): BibleSourceBook[] {
  if (Array.isArray(raw)) return raw as BibleSourceBook[];
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    if (Array.isArray(obj["books"])) return obj["books"] as BibleSourceBook[];
    return Object.entries(obj).map(([abbrev, value]) => ({
      abbrev,
      ...(value as object),
    })) as BibleSourceBook[];
  }
  throw new Error("Unrecognized Bible JSON container shape");
}

function parseBook(book: BibleSourceBook, index: number): ParsedBook {
  const abbrev = book.abbrev ?? `book-${index + 1}`;
  const name = book.name ?? book.nombre ?? "Libro";
  const testament: "OT" | "NT" = OT_ABBREVS.has(abbrev.toLowerCase()) ? "OT" : "NT";

  const chapters = normalizeChapters(book.chapters);
  const verses: ParsedVerse[] = [];
  chapters.forEach((chapterVerses, chapterIdx) => {
    chapterVerses.forEach((text, verseIdx) => {
      verses.push({ chapter: chapterIdx + 1, verse: verseIdx + 1, text });
    });
  });

  return { abbrev, name, testament, chapterCount: chapters.length, verses };
}

function normalizeChapters(raw: unknown): string[][] {
  if (Array.isArray(raw)) return raw.map(normalizeVerses);
  if (raw && typeof raw === "object") {
    return Object.keys(raw as object)
      .map(Number)
      .sort((a, b) => a - b)
      .map((n) => normalizeVerses((raw as Record<string, unknown>)[String(n)]));
  }
  throw new Error("Unrecognized chapters shape");
}

function normalizeVerses(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((v) => {
      if (typeof v === "string") return v;
      if (v && typeof v === "object") {
        const o = v as Record<string, unknown>;
        return String(o["text"] ?? o["verse"] ?? "");
      }
      return String(v ?? "");
    });
  }
  if (raw && typeof raw === "object") {
    return Object.keys(raw as object)
      .map(Number)
      .sort((a, b) => a - b)
      .map((n) => String((raw as Record<string, unknown>)[String(n)] ?? ""));
  }
  return [];
}
