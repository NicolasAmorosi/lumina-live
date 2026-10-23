import type { BibleSourceBook } from "@shared/types/bible";
import { canonByAbbrev, testamentOf } from "./canon";
import { BibleFormatError, type ParsedBible, type ParsedBook, type ParsedVerse } from "./types";
import { mt } from "../../../i18n";

/**
 * The shape the bundled `rv1909.json` uses, and the several near-misses a
 * hand-assembled file arrives in.
 *
 * Unchanged in substance from the `bible-source.ts` this replaces — it is
 * proven against the 31 102 verses actually in the box — with one fix, at
 * `bookTestament` below.
 *
 * Deliberately NOT routed through the canon the way every other format is: a
 * JSON file here is whatever somebody had, in whatever order, with whatever
 * book names, and the tolerance below is the whole point of the format. The
 * canon is consulted only to answer "which testament", and only when the
 * file's own abbreviation is one it recognises.
 */
export function parseBibleJson(raw: unknown): ParsedBible {
  const books = extractBooks(raw);
  return { name: null, language: null, books: books.map((book, index) => parseBook(book, index)) };
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
  throw new BibleFormatError(mt("bible.jsonNoBooks"));
}

/**
 * Which testament a book belongs to.
 *
 * This used to be a set of 39 abbreviations kept in this file, and the set did
 * not match the bible in the box: it spelled Samuel `1s` where `rv1909.json`
 * spells it `1sm`, Psalms `sal` where the file says `ps`, and so on for 23 of
 * the 39 Old Testament books — every one of which has been stored as `"NT"`
 * since the seed was written. Nothing reads the column yet, which is the only
 * reason nobody saw it.
 *
 * So the question is asked of the canon instead (which is keyed by the
 * spellings the bundled file actually uses, because it was built from them),
 * and falls back to the book's POSITION for a file whose abbreviations this
 * app has never seen — which is right for any bible listed in canonical
 * order, and is the only signal such a file gives at all.
 */
function bookTestament(abbrev: string, position: number): "OT" | "NT" {
  return testamentOf(canonByAbbrev(abbrev)?.index ?? position);
}

function parseBook(book: BibleSourceBook, index: number): ParsedBook {
  const abbrev = book.abbrev ?? `book-${index + 1}`;
  const name = book.name ?? book.nombre ?? "Libro";

  const chapters = normalizeChapters(book.chapters);
  const verses: ParsedVerse[] = [];
  chapters.forEach((chapterVerses, chapterIdx) => {
    chapterVerses.forEach((text, verseIdx) => {
      verses.push({ chapter: chapterIdx + 1, verse: verseIdx + 1, text });
    });
  });

  return {
    abbrev,
    name,
    testament: bookTestament(abbrev, index + 1),
    chapterCount: chapters.length,
    verses,
  };
}

function normalizeChapters(raw: unknown): string[][] {
  if (Array.isArray(raw)) return raw.map(normalizeVerses);
  if (raw && typeof raw === "object") {
    return Object.keys(raw)
      .map(Number)
      .sort((a, b) => a - b)
      .map((n) => normalizeVerses((raw as Record<string, unknown>)[String(n)]));
  }
  throw new BibleFormatError(mt("bible.jsonNoChapters"));
}

/** A verse is text or it is nothing. `String()` on a shape we did not expect
 *  writes the literal "[object Object]" into the Bible and seeds it happily —
 *  this file's whole job is to survive a JSON the user supplied, so an
 *  unreadable verse has to come out empty and be visible as empty. */
function asVerseText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function normalizeVerses(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((v) => {
      if (typeof v === "string") return v;
      if (v && typeof v === "object") {
        const o = v as Record<string, unknown>;
        return asVerseText(o["text"] ?? o["verse"]);
      }
      return asVerseText(v);
    });
  }
  if (raw && typeof raw === "object") {
    return Object.keys(raw)
      .map(Number)
      .sort((a, b) => a - b)
      .map((n) => asVerseText((raw as Record<string, unknown>)[String(n)]));
  }
  return [];
}
