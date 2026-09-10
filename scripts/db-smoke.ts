/**
 * Standalone smoke test for the data layer — runs without Electron so the DB,
 * migrations and Bible seed can be verified before any UI exists. Creates a
 * throwaway DB file under scratch/, never touches userData.
 */
import fs from "node:fs";
import path from "node:path";
import { openDatabase } from "../src/main/db/client";
import { runMigrations } from "../src/main/db/migrate";
import { seedBuiltinBibles } from "../src/main/db/seed/seed-bible";
import { BibleRepo } from "../src/main/db/repositories/bible.repo";
import { SettingsRepo } from "../src/main/db/repositories/settings.repo";
import { ProgramsRepo } from "../src/main/db/repositories/programs.repo";

const scratchDir = path.join(process.cwd(), ".scratch");
fs.mkdirSync(scratchDir, { recursive: true });
const dbFile = path.join(scratchDir, "smoke.db");
fs.rmSync(dbFile, { force: true });
fs.rmSync(`${dbFile}-wal`, { force: true });
fs.rmSync(`${dbFile}-shm`, { force: true });

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
}

async function main() {
  console.log("[1/8] Opening database…");
  const { sqlite, db } = openDatabase(dbFile);

  console.log("[2/8] Running migrations…");
  runMigrations(db, path.join(process.cwd(), "drizzle"));

  console.log("[3/8] Seeding builtin Bible…");
  const t0 = Date.now();
  seedBuiltinBibles(db, sqlite, path.join(process.cwd(), "resources/bibles"));
  console.log(`      seeded in ${Date.now() - t0}ms`);

  const bibleRepo = new BibleRepo(db, sqlite);
  const versions = bibleRepo.listVersions();
  assert(versions.length === 1, `expected 1 Bible version, got ${versions.length}`);
  assert(versions[0]!.verseCount === 31102, `expected 31102 verses, got ${versions[0]!.verseCount}`);

  const books = bibleRepo.listBooks(versions[0]!.id);
  assert(books.length === 66, `expected 66 books, got ${books.length}`);
  assert(books[0]!.name === "Génesis", `expected first book "Génesis", got "${books[0]!.name}"`);

  console.log("[4/8] Chapter lookup…");
  const genesis1 = bibleRepo.getChapter(books[0]!.id, 1);
  assert(genesis1.length === 31, `expected 31 verses in Génesis 1, got ${genesis1.length}`);

  console.log("[5/8] FTS5 search (accent-insensitive)…");
  const hits = bibleRepo.search(versions[0]!.id, "espiritu");
  assert(hits.length > 0, "expected FTS search for 'espiritu' to match 'Espíritu'");
  console.log(`      "espiritu" -> ${hits.length} hits, first: ${hits[0]!.bookName} ${hits[0]!.chapter}:${hits[0]!.verse}`);

  console.log("[6/8] Settings + programs round-trip…");
  const settingsRepo = new SettingsRepo(db);
  settingsRepo.setMany({ "ui.theme": "light" });
  assert(settingsRepo.get("ui.theme") === "light", "settings round-trip failed");

  const programsRepo = new ProgramsRepo(db, sqlite);
  const saved = programsRepo.save({
    name: "Culto de prueba",
    items: [{ kind: "text", body: "Bienvenida", title: null }],
  });
  const loaded = programsRepo.load(saved.id);
  assert(loaded.items.length === 1, "program round-trip failed");
  assert(loaded.favorite === false, "program should default to not favorite");

  console.log("[7/8] Favorite round-trip…");
  const starred = programsRepo.setFavorite(saved.id, true);
  assert(starred.favorite === true, "setFavorite(true) did not stick");
  assert(starred.updatedAt === saved.updatedAt, "setFavorite must not bump updatedAt");

  const resavedWithoutFavorite = programsRepo.save({
    id: saved.id,
    name: "Culto de prueba",
    items: [{ kind: "text", body: "Bienvenida", title: null }],
  });
  assert(resavedWithoutFavorite.favorite === true, "save() without favorite must not clobber it");

  const duplicateInherited = programsRepo.duplicate({ id: saved.id, name: "Culto de prueba (copia)" });
  assert(duplicateInherited.favorite === true, "duplicate() without favorite should inherit the source's");

  const duplicateOverridden = programsRepo.duplicate({
    id: saved.id,
    name: "Culto de prueba (copia 2)",
    favorite: false,
    notes: "nota de la copia",
  });
  assert(duplicateOverridden.favorite === false, "duplicate() with favorite should respect it");
  assert(duplicateOverridden.notes === "nota de la copia", "duplicate() with notes should respect it");

  console.log("[8/8] Manual list order…");
  // `saved` was the first row created and has since been `load()`ed (which
  // bumps `lastOpenedAt`), so finding it last proves the list is ordered by
  // `sortOrder` and that opening a program no longer reshuffles it.
  const byOrder = programsRepo.list().map((p) => p.id);
  assert(
    byOrder.join() === [duplicateOverridden.id, duplicateInherited.id, saved.id].join(),
    `new programs should land on top, got ${byOrder.join()}`,
  );

  const desired = [saved.id, duplicateOverridden.id, duplicateInherited.id];
  const reordered = programsRepo.reorder(desired);
  assert(reordered.map((p) => p.id).join() === desired.join(), "reorder() did not apply the given order");
  assert(
    programsRepo.list().map((p) => p.id).join() === desired.join(),
    "reorder() did not survive a re-read",
  );
  const afterReopen = programsRepo.load(duplicateInherited.id);
  assert(afterReopen.id === duplicateInherited.id, "load() failed after a reorder");
  assert(
    programsRepo.list().map((p) => p.id).join() === desired.join(),
    "opening a program must not change the manual order",
  );

  sqlite.close();
  console.log("\nAll checks passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
