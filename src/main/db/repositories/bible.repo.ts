import { and, eq } from "drizzle-orm";
import type Database from "better-sqlite3";
import type { Db } from "../client";
import { bibleBooks, bibleVersions, bibleVerses } from "../schema";
import type {
  BibleBookDTO,
  BibleSearchHit,
  BibleVerseDTO,
  BibleVersionDTO,
} from "@shared/types/bible";

/** Wraps user input into an FTS5 MATCH-safe query: each token is quoted so stray
 *  apostrophes/quotes/operators in what someone types can't produce a MATCH syntax
 *  error, then joined with implicit AND. The last token — the one still being
 *  typed on every keystroke of a live search — gets a trailing `*` for prefix
 *  matching, so "am" starts finding "amor" before the whole word is typed
 *  instead of the result set lurching once it suddenly becomes a whole word.
 *  Earlier, already-finished tokens stay exact matches to keep results precise. */
function toFtsQuery(input: string): string {
  const tokens = input
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => `"${t.replace(/"/g, '""')}"`);
  const lastIndex = tokens.length - 1;
  if (lastIndex >= 0) tokens[lastIndex] += "*";
  return tokens.join(" ");
}

export class BibleRepo {
  constructor(
    private readonly db: Db,
    private readonly sqlite: Database.Database,
  ) {}

  listVersions(): BibleVersionDTO[] {
    return this.db
      .select()
      .from(bibleVersions)
      .all()
      .map((v) => ({
        id: v.id,
        code: v.code,
        name: v.name,
        language: v.language,
        isBuiltin: v.isBuiltin === 1,
        verseCount: v.verseCount,
      }));
  }

  listBooks(versionId: number): BibleBookDTO[] {
    return this.db
      .select()
      .from(bibleBooks)
      .where(eq(bibleBooks.versionId, versionId))
      .orderBy(bibleBooks.position)
      .all()
      .map((b) => ({
        id: b.id,
        versionId: b.versionId,
        position: b.position,
        abbrev: b.abbrev,
        name: b.name,
        testament: b.testament,
        chapterCount: b.chapterCount,
      }));
  }

  getChapter(bookId: number, chapter: number): BibleVerseDTO[] {
    const book = this.db.select().from(bibleBooks).where(eq(bibleBooks.id, bookId)).get();
    if (!book) return [];
    return this.db
      .select()
      .from(bibleVerses)
      .where(and(eq(bibleVerses.bookId, bookId), eq(bibleVerses.chapter, chapter)))
      .orderBy(bibleVerses.verse)
      .all()
      .map((v) => ({
        id: v.id,
        bookId: v.bookId,
        bookName: book.name,
        chapter: v.chapter,
        verse: v.verse,
        text: v.text,
      }));
  }

  search(versionId: number, query: string, limit = 100): BibleSearchHit[] {
    const ftsQuery = toFtsQuery(query);
    if (!ftsQuery) return [];

    const stmt = this.sqlite.prepare(`
      SELECT v.id AS id, v.book_id AS bookId, b.name AS bookName, v.chapter AS chapter,
             v.verse AS verse, v.text AS text,
             snippet(bible_verses_fts, 0, '<mark>', '</mark>', '…', 12) AS snippet
      FROM bible_verses_fts f
      JOIN bible_verses v ON v.id = f.rowid
      JOIN bible_books b ON b.id = v.book_id
      WHERE bible_verses_fts MATCH ? AND v.version_id = ?
      ORDER BY bm25(bible_verses_fts)
      LIMIT ?
    `);

    try {
      return stmt.all(ftsQuery, versionId, limit) as BibleSearchHit[];
    } catch {
      // A pathological query (bare operator, etc.) that still slipped through toFtsQuery.
      return [];
    }
  }
}
