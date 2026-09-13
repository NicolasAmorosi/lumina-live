import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { eq } from "drizzle-orm";
import type Database from "better-sqlite3";
import type { Db } from "../client";
import { bibleBooks, bibleVersions } from "../schema";
import { parseBibleSource } from "./bible-source";
import { BUILTIN_BIBLE_CODE } from "@shared/constants";

const BUILTIN_BIBLE_NAME = "Reina-Valera 1960";

/**
 * Imports (or re-imports, if the source file changed) a Bible JSON into the
 * relational tables + FTS5 index. Runs as ONE transaction so a crash mid-seed
 * never leaves a half-imported version. Deliberately writes nothing back to
 * the source JSON's own directory — the legacy `import-bible` bug it replaces
 * wrote into the app bundle itself, which fails on a packaged install.
 */
export function seedBibleFromFile(
  db: Db,
  sqlite: Database.Database,
  filePath: string,
  code: string,
  name: string,
  isBuiltin: boolean,
): { versionId: number; verseCount: number } | null {
  // Read as bytes, not as a string: the unchanged case (every launch after
  // the first) only needs the digest, and decoding 4 MB of UTF-8 into a JS
  // string just to throw it away is the larger half of the cost.
  const raw = fs.readFileSync(filePath);
  const sourceHash = crypto.createHash("sha256").update(raw).digest("hex");

  const existing = db.select().from(bibleVersions).where(eq(bibleVersions.code, code)).get();
  if (existing && existing.sourceHash === sourceHash) {
    return { versionId: existing.id, verseCount: existing.verseCount };
  }

  const parsedBooks = parseBibleSource(JSON.parse(raw.toString("utf-8")));
  const now = Date.now();

  const run = sqlite.transaction(() => {
    if (existing) {
      // ON DELETE CASCADE removes bible_books/bible_verses (and the FTS rows via triggers).
      db.delete(bibleVersions).where(eq(bibleVersions.id, existing.id)).run();
    }

    const totalVerses = parsedBooks.reduce((sum, b) => sum + b.verses.length, 0);
    const versionId = db
      .insert(bibleVersions)
      .values({
        code,
        name,
        language: "es",
        isBuiltin: isBuiltin ? 1 : 0,
        verseCount: totalVerses,
        sourceHash,
        installedAt: now,
      })
      .run().lastInsertRowid as number;

    const insertVerse = sqlite.prepare(
      `INSERT INTO bible_verses (version_id, book_id, chapter, verse, text) VALUES (?, ?, ?, ?, ?)`,
    );

    parsedBooks.forEach((book, index) => {
      const bookId = db
        .insert(bibleBooks)
        .values({
          versionId,
          position: index + 1,
          abbrev: book.abbrev,
          name: book.name,
          testament: book.testament,
          chapterCount: book.chapterCount,
        })
        .run().lastInsertRowid as number;

      for (const v of book.verses) {
        insertVerse.run(versionId, bookId, v.chapter, v.verse, v.text);
      }
    });

    // Rebuilding once after the bulk load is far cheaper than firing the sync
    // triggers 31k times individually; see docs/knowledge for the measured cost.
    sqlite.exec(`INSERT INTO bible_verses_fts(bible_verses_fts) VALUES('rebuild')`);

    return { versionId, verseCount: totalVerses };
  });

  return run();
}

export function seedBuiltinBibles(db: Db, sqlite: Database.Database, biblesDir: string): void {
  const filePath = path.join(biblesDir, `${BUILTIN_BIBLE_CODE}.json`);
  if (!fs.existsSync(filePath)) return;
  seedBibleFromFile(db, sqlite, filePath, BUILTIN_BIBLE_CODE, BUILTIN_BIBLE_NAME, true);
}
