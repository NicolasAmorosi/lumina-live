/**
 * The data layer, without Electron: migrations, the Bible seed and FTS5, every
 * repository, the unsaved-schedule draft, the `settings:set` validators and the
 * WAL-aware pre-migration backup.
 *
 * This is the former `scripts/db-smoke.ts`, assertion for assertion. It ran as
 * a script because there was no runner; now that there is one, the same checks
 * report per case, fail with a name instead of a stack, and stop being
 * something a person has to remember to run.
 *
 * The cases share ONE database on purpose, built up in order — several of them
 * assert about what earlier ones left behind (the manual list order, the
 * duplicate-bytes deck, the draft's dead reference). Vitest runs the tests of a
 * file in declaration order, which is what keeps that chain honest.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import Database from "better-sqlite3";
import { openDatabase } from "../../src/main/db/client";
import { backupBeforeMigrate, runMigrations } from "../../src/main/db/migrate";
import { seedBuiltinBibles } from "../../src/main/db/seed/seed-bible";
import { mediaAssets } from "../../src/main/db/schema";
import { BibleRepo } from "../../src/main/db/repositories/bible.repo";
import { SettingsRepo } from "../../src/main/db/repositories/settings.repo";
import { ProgramsRepo } from "../../src/main/db/repositories/programs.repo";
import { MediaRepo } from "../../src/main/db/repositories/media.repo";
import { SlidesRepo } from "../../src/main/db/repositories/slides.repo";
import { DraftRepo } from "../../src/main/db/repositories/draft.repo";
import { UtilityRepo } from "../../src/main/db/repositories/utility.repo";
import { seedUtilityScenes } from "../../src/main/db/seed/seed-utility-scenes";
import { initRepos } from "../../src/main/services/repos";
import { readBinarySlideTimings } from "../../src/main/slides/ppt-binary-timings";
import { backfillDeckTimings } from "../../src/main/slides/backfill-timings";
import { SNIPPET_MARK_END, SNIPPET_MARK_START, parseSnippet } from "../../src/shared/types/bible";
import { SETTINGS_VALIDATORS, isSettingsKey } from "../../src/shared/types/settings";
import { DEFAULT_UTILITY_SCENES } from "../../src/shared/types/utility";
import { buildLegacyPpt } from "../fixtures/legacy-ppt";
import type { ProgramSummary } from "../../src/shared/types/program";
import type { MediaAsset } from "../../src/shared/types/media";

/** Keeps the original script's one-line diagnostics: every message below says
 *  what the invariant is, which is worth more on a failure than a diff. */
function assert(condition: unknown, message: string): asserts condition {
  expect(condition, message).toBeTruthy();
}

const drizzleDir = path.join(process.cwd(), "drizzle");
const biblesDir = path.join(process.cwd(), "resources/bibles");

let tmpDir: string;
let dbFile: string;
let sqlite: ReturnType<typeof openDatabase>["sqlite"];
let db: ReturnType<typeof openDatabase>["db"];

let bibleRepo: BibleRepo;
let settingsRepo: SettingsRepo;
let programsRepo: ProgramsRepo;
let mediaRepo: MediaRepo;
let slidesRepo: SlidesRepo;
let utilityRepo: UtilityRepo;

let versionId: number;
let bookIds: number[];
let saved: ProgramSummary;
let duplicateInherited: ProgramSummary;
let duplicateOverridden: ProgramSummary;
let mediaDir: string;
let filePaths: string[];
let statted: { path: string; stat: fs.Stats }[];
let inserted: MediaAsset[];
let firstAsset: MediaAsset;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "worship-data-layer-"));
  dbFile = path.join(tmpDir, "smoke.db");
  const opened = openDatabase(dbFile);
  sqlite = opened.sqlite;
  db = opened.db;
  runMigrations(db, drizzleDir);
  seedBuiltinBibles(db, sqlite, biblesDir);

  bibleRepo = new BibleRepo(db, sqlite);
  settingsRepo = new SettingsRepo(db);
  programsRepo = new ProgramsRepo(db, sqlite);
  mediaRepo = new MediaRepo(db, sqlite);
  slidesRepo = new SlidesRepo(db, sqlite);
  utilityRepo = new UtilityRepo(db, sqlite);
});

afterAll(() => {
  sqlite.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("Bible seed", () => {
  test("seeds exactly one version with every verse and book", () => {
    const versions = bibleRepo.listVersions();
    assert(versions.length === 1, `expected 1 Bible version, got ${versions.length}`);
    assert(versions[0]!.verseCount === 31102, `expected 31102 verses, got ${versions[0]!.verseCount}`);
    versionId = versions[0]!.id;

    const books = bibleRepo.listBooks(versionId);
    assert(books.length === 66, `expected 66 books, got ${books.length}`);
    assert(books[0]!.name === "Génesis", `expected first book "Génesis", got "${books[0]!.name}"`);
    bookIds = books.map((book) => book.id);
  });

  test("chapter lookup returns the whole chapter", () => {
    const genesis1 = bibleRepo.getChapter(bookIds[0]!, 1);
    assert(genesis1.length === 31, `expected 31 verses in Génesis 1, got ${genesis1.length}`);
  });

  test("FTS5 search is accent-insensitive and its snippets are never markup", () => {
    const hits = bibleRepo.search(versionId, "espiritu");
    assert(hits.length > 0, "expected FTS search for 'espiritu' to match 'Espíritu'");

    // The snippet must not be markup. It used to be wrapped in `<mark>` tags and
    // handed to `dangerouslySetInnerHTML`, which made the text of a verse — from
    // whatever JSON the operator imported — executable in the control window.
    const marked = hits.find((hit) => hit.snippet.includes(SNIPPET_MARK_START));
    assert(marked !== undefined, "expected at least one snippet to carry a match marker");
    assert(
      !hits.some((hit) => hit.snippet.includes("<")),
      "snippets must never contain markup — see SNIPPET_MARK_START in shared/types/bible.ts",
    );
    const segments = parseSnippet(marked.snippet);
    assert(
      segments.some((segment) => segment.match) && segments.some((segment) => !segment.match),
      "parseSnippet should split a marked snippet into matched and plain runs",
    );
    assert(
      segments.map((segment) => segment.text).join("") ===
        marked.snippet.split(SNIPPET_MARK_START).join("").split(SNIPPET_MARK_END).join(""),
      "parseSnippet must preserve every character except the markers",
    );
  });
});

describe("Settings and programs", () => {
  test("settings and a program round-trip", () => {
    settingsRepo.setMany({ "ui.theme": "light" });
    assert(settingsRepo.get("ui.theme") === "light", "settings round-trip failed");

    saved = programsRepo.save({
      name: "Culto de prueba",
      items: [
        { kind: "bible", bibleVersionId: null, bibleBookId: null, chapter: null, verseFrom: null, verseTo: null, reference: "Juan 3:16", text: "Porque de tal manera…" },
      ],
    });
    const loaded = programsRepo.load(saved.id);
    assert(loaded.items.length === 1, "program round-trip failed");
    assert(loaded.favorite === false, "program should default to not favorite");
  });

  test("favorite survives a re-save and is inherited by a duplicate", () => {
    const starred = programsRepo.setFavorite(saved.id, true);
    assert(starred.favorite === true, "setFavorite(true) did not stick");
    assert(starred.updatedAt === saved.updatedAt, "setFavorite must not bump updatedAt");

    const resavedWithoutFavorite = programsRepo.save({
      id: saved.id,
      name: "Culto de prueba",
      items: [
        { kind: "bible", bibleVersionId: null, bibleBookId: null, chapter: null, verseFrom: null, verseTo: null, reference: "Juan 3:16", text: "Porque de tal manera…" },
      ],
    });
    assert(resavedWithoutFavorite.favorite === true, "save() without favorite must not clobber it");

    duplicateInherited = programsRepo.duplicate({ id: saved.id, name: "Culto de prueba (copia)" });
    assert(duplicateInherited.favorite === true, "duplicate() without favorite should inherit the source's");

    duplicateOverridden = programsRepo.duplicate({
      id: saved.id,
      name: "Culto de prueba (copia 2)",
      favorite: false,
      notes: "nota de la copia",
    });
    assert(duplicateOverridden.favorite === false, "duplicate() with favorite should respect it");
    assert(duplicateOverridden.notes === "nota de la copia", "duplicate() with notes should respect it");
  });

  test("the list keeps its manual order, counts items, and opening never reshuffles", () => {
    // `saved` was the first row created and has since been `load()`ed (which
    // bumps `lastOpenedAt`), so finding it last proves the list is ordered by
    // `sortOrder` and that opening a program no longer reshuffles it.
    const byOrder = programsRepo.list().map((p) => p.id);
    assert(
      byOrder.join() === [duplicateOverridden.id, duplicateInherited.id, saved.id].join(),
      `new programs should land on top, got ${byOrder.join()}`,
    );

    // `itemCount` comes from a LEFT JOIN + GROUP BY, so the case that can break
    // silently is the one with nothing to join against: an empty program must
    // still be listed, and at 0 rather than at the 1 the join's null row counts.
    const empty = programsRepo.save({ name: "Programa vacío", items: [] });
    const counts = new Map(programsRepo.list().map((p) => [p.id, p.itemCount]));
    assert(counts.get(empty.id) === 0, `an empty program should list with itemCount 0, got ${counts.get(empty.id)}`);
    assert(counts.get(saved.id) === 1, `itemCount should count the program's items, got ${counts.get(saved.id)}`);
    assert(counts.size === 4, `every program must survive the join, got ${counts.size} of 4`);
    programsRepo.delete(empty.id);

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
  });
});

describe("Media library", () => {
  test("a batch import inserts every file and resolves no audio eagerly", () => {
    mediaDir = path.join(tmpDir, "media");
    fs.mkdirSync(mediaDir, { recursive: true });
    filePaths = Array.from({ length: 25 }, (_, i) => {
      const p = path.join(mediaDir, `deck-${i}.pptx`);
      fs.writeFileSync(p, `fake pptx ${i}`);
      return p;
    });

    statted = filePaths.map((p) => ({ path: p, stat: fs.statSync(p) }));
    const batch = mediaRepo.upsertBatch(statted, "ppt", true);
    inserted = batch.assets;
    firstAsset = inserted[0]!;
    assert(inserted.length === 25, `expected 25 inserted assets, got ${inserted.length}`);
    assert(batch.mutated === 25, `a fresh import of 25 new files should report 25 mutated, got ${batch.mutated}`);
    assert(
      inserted.every((a) => a.linkedAudioPath === null),
      "a fresh import must never resolve linked audio eagerly",
    );
    assert(
      mediaRepo.list("ppt").length === 25,
      `expected 25 ppt assets in the library, got ${mediaRepo.list("ppt").length}`,
    );
  });

  test("re-importing unchanged files reports zero mutations", () => {
    // This is the regression test for the import→library-changed→listFolder
    // loop: a `library:listFolder` re-scan of an untouched folder must be able
    // to tell "nothing to broadcast" from "something changed", or it will
    // broadcast `library-changed` and re-trigger itself forever.
    const { assets: restatted, mutated: stableMutated } = mediaRepo.upsertBatch(statted, "ppt", true);
    assert(restatted.length === 25, "a stable re-import must still return every asset");
    assert(stableMutated === 0, `re-importing unchanged files should mutate nothing, got ${stableMutated}`);
  });

  test("reactivation is OR, not overwrite", () => {
    // Deactivate one row directly (simulating "no longer in the library, but
    // still on disk") before re-importing the same files.
    db.update(mediaAssets).set({ inLibrary: 0 }).where(eq(mediaAssets.id, firstAsset.id)).run();

    const { assets: reimported, mutated: reimportedMutated } = mediaRepo.upsertBatch(statted, "ppt", true);
    assert(reimported.length === 25, "re-import must return the same count");
    assert(reimportedMutated === 1, `only the deactivated row should count as mutated, got ${reimportedMutated}`);
    const reactivated = reimported.find((a) => a.id === firstAsset.id);
    assert(reactivated?.inLibrary === true, "re-importing with inLibrary:true must reactivate a deactivated row");
  });

  test("re-importing a CHANGED file returns the new size and mtime", () => {
    // A library thumbnail's cache-buster is built from the asset DTO's
    // `sizeBytes`+`mtimeMs` (`assetThumbVersion`), and the deck cache's cheapest
    // hit compares the same two values. Both branches of the upsert used to
    // return the row as it was READ rather than as it was written, so a caller
    // acting on an edited file got the previous file's identity back and would
    // keep pointing at the previous file's thumbnail.
    const changedPath = filePaths[1]!;
    fs.writeFileSync(changedPath, "fake pptx 1 — now a different length entirely");
    // Some filesystems have coarse mtime granularity; force a distinct one so
    // this asserts the write-through, not the clock.
    const bumped = new Date(Date.now() + 5_000);
    fs.utimesSync(changedPath, bumped, bumped);
    const changedStat = fs.statSync(changedPath);

    const { assets: afterEdit } = mediaRepo.upsertBatch([{ path: changedPath, stat: changedStat }], "ppt", true);
    const editedBatch = afterEdit[0]!;
    assert(
      editedBatch.sizeBytes === changedStat.size,
      `upsertBatch must return the new size (${String(changedStat.size)}), got ${String(editedBatch.sizeBytes)}`,
    );
    assert(
      editedBatch.mtimeMs === Math.trunc(changedStat.mtimeMs),
      "upsertBatch must return the new mtime, not the row's previous one",
    );

    const editedSingle = mediaRepo.upsertFromPath(changedPath, "ppt", true);
    assert(
      editedSingle.sizeBytes === changedStat.size && editedSingle.mtimeMs === Math.trunc(changedStat.mtimeMs),
      "upsertFromPath's existing-row branch must return what it just wrote, not the stale row",
    );
    assert(
      mediaRepo.getById(editedSingle.id)?.mtimeMs === Math.trunc(changedStat.mtimeMs),
      "the persisted row must agree with the returned DTO",
    );
  });

  test("the sweep marks a vanished file and clears the mark when it comes back", async () => {
    fs.rmSync(filePaths[0]!);
    const changedOnMissing = await mediaRepo.sweep();
    assert(changedOnMissing.has("ppt"), "sweep must report 'ppt' changed when a ppt file goes missing");
    const afterMissing = mediaRepo.getById(firstAsset.id);
    assert(afterMissing?.missingSince !== null, "sweep must mark a vanished file's row as missing");

    fs.writeFileSync(filePaths[0]!, "fake pptx 0 restored");
    const changedOnReappear = await mediaRepo.sweep();
    assert(changedOnReappear.has("ppt"), "sweep must report 'ppt' changed when a missing file reappears");
    const afterReappear = mediaRepo.getById(firstAsset.id);
    assert(afterReappear?.missingSince === null, "sweep must clear missingSince once the file is back");
  });
});

describe("Deck status is answered by CONTENT, not by row ownership", () => {
  // The regression test for `N3` (media-chain audit §5.2). The deck cache is
  // content-addressed, but `statusesByAsset` used to ask "which deck row does
  // this asset OWN?" — and `relinkDeck` MOVES that ownership. With the same
  // file present twice (every hymn in the library that motivated this is), one
  // asset held the row and the other reported "pending" forever: 555 of 1235
  // assets offered for conversion with zero work to do, and a count that
  // oscillated instead of reaching zero, because preparing one folder stole
  // the rows back from the other.
  let dupA: MediaAsset;
  let dupB: MediaAsset;
  let deckId: number;

  test("both copies of the same bytes report ready, and point at the same deck", () => {
    const dupBytes = "fake pptx — two copies of the very same bytes";
    const dupPaths = ["dup-cantado.pps", "dup-instrumental.pps"].map((name) => {
      const full = path.join(mediaDir, name);
      fs.writeFileSync(full, dupBytes);
      return full;
    });
    const { assets: dupAssets } = mediaRepo.upsertBatch(
      dupPaths.map((p) => ({ path: p, stat: fs.statSync(p) })),
      "ppt",
      true,
    );
    assert(dupAssets[0] && dupAssets[1], "both duplicate copies must import as their own assets");
    dupA = dupAssets[0];
    dupB = dupAssets[1];

    // What the startup backfill does: same bytes → same digest, each stamped
    // with its own file's (size, mtime).
    const dupHash = "0".repeat(64);
    for (const asset of [dupA, dupB]) {
      const stat = fs.statSync(asset.path);
      mediaRepo.setContentHash(asset.id, dupHash, stat.size, Math.trunc(stat.mtimeMs));
    }

    // One deck row for those bytes, owned by the copy that happened to be opened
    // first — exactly what `relinkDeck` leaves behind.
    const dupStat = fs.statSync(dupA.path);
    deckId = slidesRepo.insertDeck(
      {
        contentHash: dupHash,
        renderWidth: 1920,
        imageFormat: "webp",
        converterVersion: 1,
        mediaAssetId: dupA.id,
        sourcePath: dupA.path,
        sourceSizeBytes: dupStat.size,
        sourceMtimeMs: Math.trunc(dupStat.mtimeMs),
        cacheDir: path.join(tmpDir, "deck-dup"),
        aspectRatio: "16:9",
        timingsSource: "none",
        bytesOnDisk: 1024,
      },
      [
        {
          slideIndex: 1,
          imageFile: "1.webp",
          thumbFile: "1.thumb.webp",
          widthPx: 1920,
          heightPx: 1080,
          bytes: 1024,
          advanceMs: null,
          advanceOnClick: true,
          transitionMs: null,
          hidden: false,
          title: null,
          notes: null,
        },
      ],
      [],
    );

    const bothWays = slidesRepo.statusesByAsset([dupA.id, dupB.id]);
    assert(
      bothWays.get(dupA.id)?.status === "ready",
      "the asset that owns the deck row must report ready (it always did)",
    );
    assert(
      bothWays.get(dupB.id)?.status === "ready",
      "the OTHER copy of the same bytes must report ready too — this is N3",
    );
    assert(
      bothWays.get(dupB.id)?.deckId === deckId,
      "both copies must point at the one deck their bytes actually live in",
    );
  });

  test("relinking the row to one copy does not unconvert the other", () => {
    // Opening the second copy relinks the row to it. The first must not regress
    // to "pending" — that swap is what made the count oscillate.
    const dupBStat = fs.statSync(dupB.path);
    slidesRepo.relinkDeck(deckId, dupB.id, dupB.path, dupBStat.size, Math.trunc(dupBStat.mtimeMs));
    const afterRelink = slidesRepo.statusesByAsset([dupA.id, dupB.id]);
    assert(
      afterRelink.get(dupA.id)?.status === "ready" && afterRelink.get(dupB.id)?.status === "ready",
      "relinking the row to one copy must not make the other look unconverted",
    );
  });

  test("a stale content-hash stamp stops matching once the file is edited", () => {
    // A file edited behind our back invalidates its own stamp: the digest on the
    // row describes bytes that no longer exist, so it must stop matching.
    fs.writeFileSync(dupA.path, "edited — these are different bytes now");
    const editedDupStat = fs.statSync(dupA.path);
    db.update(mediaAssets)
      .set({ sizeBytes: editedDupStat.size, mtimeMs: Math.trunc(editedDupStat.mtimeMs) })
      .where(eq(mediaAssets.id, dupA.id))
      .run();
    const afterEditStatuses = slidesRepo.statusesByAsset([dupA.id]);
    assert(
      afterEditStatuses.get(dupA.id) === undefined,
      "a stale content-hash stamp must not match a deck (the bytes changed)",
    );
  });
});

describe("Auto-advance survives the LibreOffice round-trip that drops it", () => {
  // The regression test for the auto-advance loss (media-chain audit §11).
  // LibreOffice's PPTX export only writes `<p:transition>` when the slide has
  // a visual EFFECT, and `advTm` is an attribute of that element — so a slide
  // set to "no transition, advance after 27 s" comes out of the round-trip
  // with no timing at all. 222 of the user's 1226 hymnal decks are affected.
  // The fix re-reads the times from the source binary; this builds a minimal
  // OLE2 `.ppt` so that reader is exercised without shipping a real deck.
  let legacyPath: string;
  let legacyStat: fs.Stats;
  let legacyDeckId: number;

  const legacySlide = (slideIndex: number) => ({
    slideIndex,
    imageFile: `${slideIndex}.webp`,
    thumbFile: `${slideIndex}.thumb.webp`,
    widthPx: 1920,
    heightPx: 1080,
    bytes: 1024,
    advanceMs: null as number | null,
    advanceOnClick: true,
    transitionMs: null,
    hidden: false,
    title: null,
    notes: null,
  });

  test("the binary reader reads the times a converted .pptx would have lost", () => {
    legacyPath = path.join(mediaDir, "legacy-timings.ppt");
    fs.writeFileSync(legacyPath, buildLegacyPpt());
    legacyStat = fs.statSync(legacyPath);

    const binaryTimings = readBinarySlideTimings(legacyPath);
    assert(binaryTimings !== null, "the synthetic legacy .ppt must parse");
    assert(binaryTimings.length === 2, `expected 2 slides, got ${binaryTimings.length}`);
    assert(
      binaryTimings[0]!.autoAdvanceMs === 12345,
      `slide 1 must carry its auto-advance time, got ${String(binaryTimings[0]!.autoAdvanceMs)}`,
    );
    assert(
      binaryTimings[1]!.autoAdvanceMs === null,
      "slide 2 has fAutoAdvance clear, so its stale slideTime must be ignored",
    );
  });

  test("the backfill writes them into an already-converted deck", async () => {
    // End to end through the backfill: a deck already converted, both slides
    // with a NULL advance_ms, gets the times written back with no reconversion.
    initRepos(db, sqlite);
    const legacyAsset = mediaRepo.upsertFromPath(legacyPath, "ppt", true);
    legacyDeckId = slidesRepo.insertDeck(
      {
        contentHash: "1".repeat(64),
        renderWidth: 1920,
        imageFormat: "webp",
        converterVersion: 1,
        mediaAssetId: legacyAsset.id,
        sourcePath: legacyPath,
        sourceSizeBytes: legacyStat.size,
        sourceMtimeMs: Math.trunc(legacyStat.mtimeMs),
        cacheDir: path.join(tmpDir, "deck-legacy"),
        aspectRatio: "4:3",
        timingsSource: "ooxml-converted",
        bytesOnDisk: 2048,
      },
      [legacySlide(1), legacySlide(2)],
      [],
    );

    assert(
      slidesRepo.decksNeedingTimings().some((d) => d.id === legacyDeckId),
      "a converted legacy deck with NULL advance times must be picked up by the backfill",
    );

    await backfillDeckTimings();
    const afterBackfill = slidesRepo.slideAdvanceTimes(legacyDeckId);
    assert(
      afterBackfill[0]?.advanceMs === 12345,
      `slide 1 must have been backfilled, got ${String(afterBackfill[0]?.advanceMs)}`,
    );
    assert(
      afterBackfill[1]?.advanceMs === null,
      "slide 2 auto-advances in neither reading, so it must stay null",
    );
  });

  test("a deck whose two readings disagree is left completely untouched", async () => {
    // The guard that makes the whole thing safe: the two readings come from
    // independent paths, so a disagreement means one of them is describing the
    // wrong slide — and a deck advancing on the wrong timing mid-service is
    // worse than one that does not advance. Nothing may be written.
    const disagreeDeckId = slidesRepo.insertDeck(
      {
        contentHash: "2".repeat(64),
        renderWidth: 1920,
        imageFormat: "webp",
        converterVersion: 1,
        mediaAssetId: null,
        sourcePath: legacyPath,
        sourceSizeBytes: legacyStat.size,
        sourceMtimeMs: Math.trunc(legacyStat.mtimeMs),
        cacheDir: path.join(tmpDir, "deck-legacy-disagree"),
        aspectRatio: "4:3",
        timingsSource: "ooxml-converted",
        bytesOnDisk: 2048,
      },
      [{ ...legacySlide(1), advanceMs: 90_000 }, legacySlide(2)],
      [],
    );
    await backfillDeckTimings();
    const afterDisagreement = slidesRepo.slideAdvanceTimes(disagreeDeckId);
    assert(
      afterDisagreement[0]?.advanceMs === 90_000 && afterDisagreement[1]?.advanceMs === null,
      "a deck whose two readings disagree must be left completely untouched",
    );
  });

  test("a deck whose source no longer matches its (size, mtime) is skipped", async () => {
    // A source that changed since the conversion describes slides nobody
    // rendered, so its times must not be adopted either.
    const staleDeckId = slidesRepo.insertDeck(
      {
        contentHash: "3".repeat(64),
        renderWidth: 1920,
        imageFormat: "webp",
        converterVersion: 1,
        mediaAssetId: null,
        sourcePath: legacyPath,
        sourceSizeBytes: legacyStat.size + 1,
        sourceMtimeMs: Math.trunc(legacyStat.mtimeMs),
        cacheDir: path.join(tmpDir, "deck-legacy-stale"),
        aspectRatio: "4:3",
        timingsSource: "ooxml-converted",
        bytesOnDisk: 2048,
      },
      [legacySlide(1), legacySlide(2)],
      [],
    );
    await backfillDeckTimings();
    assert(
      slidesRepo.slideAdvanceTimes(staleDeckId).every((s) => s.advanceMs === null),
      "a deck whose source no longer matches its (size, mtime) must be skipped",
    );
  });
});

describe("Unsaved-schedule draft", () => {
  let draftRepo: DraftRepo;

  test("round-trips, and drops items pointing at a deleted asset", () => {
    draftRepo = new DraftRepo(db);
    assert(draftRepo.load() === null, "a database with no draft row must report no draft");

    const liveAsset = mediaRepo.list("ppt")[0]!;
    const deadAssetId = 999_999;
    draftRepo.save({
      programId: null,
      name: "Culto sin guardar",
      notes: null,
      items: [
        { kind: "ppt", mediaAssetId: liveAsset.id, title: null },
        { kind: "media", mediaAssetId: deadAssetId, title: null },
        { kind: "bible", bibleVersionId: null, bibleBookId: null, chapter: null, verseFrom: null, verseTo: null, reference: "Juan 3:16", text: "Porque de tal manera…" },
      ],
      updatedAt: Date.now(),
    });
    const restored = draftRepo.load();
    assert(restored !== null, "a saved draft must come back");
    assert(restored.name === "Culto sin guardar", `draft name lost: ${restored.name}`);
    // The whole reason the items are a JSON blob and not `program_items` rows:
    // a draft may reference an asset that has since been deleted, and must come
    // back without it rather than either failing or handing the renderer a tile
    // that can never preview, never go live and never explain itself.
    assert(
      restored.items.length === 2 &&
        !restored.items.some((i) => (i.kind === "media" || i.kind === "ppt") && i.mediaAssetId === deadAssetId),
      `expected the item pointing at a deleted asset to be dropped, got ${JSON.stringify(restored.items)}`,
    );
  });

  test("there is always exactly one draft row, and clearing leaves nothing", () => {
    // One row, always: saving twice replaces rather than accumulates.
    draftRepo.save({ programId: 1, name: "Otro", notes: "n", items: [], updatedAt: Date.now() });
    const second = draftRepo.load();
    assert(second?.name === "Otro" && second.programId === 1, "the draft row must be replaced, not appended");
    draftRepo.clear();
    assert(draftRepo.load() === null, "clearing the draft must leave nothing behind");
  });
});

describe("settings:set validators reject what the types cannot", () => {
  test("an unknown key never reaches the table", () => {
    assert(!isSettingsKey("ui.themee"), "an unknown settings key must be rejected");
  });

  test("each key validates its own value", () => {
    assert(SETTINGS_VALIDATORS["ui.theme"]("dark"), "a valid theme must pass");
    // The exact value from the audit: it used to persist, be read at startup and
    // land in `document.documentElement.dataset.theme`, leaving the app with no
    // theme at all until someone edited the database by hand.
    assert(!SETTINGS_VALIDATORS["ui.theme"]("purple"), '"purple" must never reach the settings table');
    assert(!SETTINGS_VALIDATORS["projection.displayId"]("2"), 'the STRING "2" must not pass as a display id');
    assert(SETTINGS_VALIDATORS["projection.displayId"](null), "a null display id is the default and must pass");
    assert(!SETTINGS_VALIDATORS["media.volume"](1.5), "a volume outside 0..1 must be rejected");
    assert(!SETTINGS_VALIDATORS["media.volume"](Number.NaN), "NaN must be rejected — it survives JSON as null");
    assert(
      !SETTINGS_VALIDATORS["library.linkedFolders"]({ video: [], image: [], audio: [] }),
      "a per-kind record missing a kind must be rejected",
    );
    assert(
      SETTINGS_VALIDATORS["library.linkedFolders"]({ video: [], image: [], audio: [], ppt: ["/x"] }),
      "a complete per-kind record must pass",
    );
  });
});

describe("The pre-migration backup is WAL-aware", () => {
  // The failure this replaces: `fs.copyFileSync` of a WAL database copies only
  // the main file, so every transaction since the last checkpoint is silently
  // missing — exactly the state a dirty shutdown or a power cut leaves behind,
  // which is when the backup is the only thing standing between the operator
  // and a lost library.
  test("VACUUM INTO captures the un-checkpointed WAL that a plain copy loses", () => {
    const walDbFile = path.join(tmpDir, "wal-backup.db");
    const walBackupDir = path.join(tmpDir, "wal-backup-dir");

    const hot = new Database(walDbFile);
    hot.pragma("journal_mode = WAL");
    hot.exec("CREATE TABLE t (n INTEGER)");
    const insertRow = hot.prepare("INSERT INTO t VALUES (?)");
    for (let i = 0; i < 5_000; i += 1) insertRow.run(i);
    const walBytes = fs.statSync(`${walDbFile}-wal`).size;
    assert(walBytes > 0, "the fixture must leave an un-checkpointed WAL behind");
    // Left deliberately open: closing would checkpoint, which is the one case
    // the old implementation did get right.

    const result = backupBeforeMigrate(walDbFile, walBackupDir, drizzleDir);
    assert(result.status === "ok", `expected a verified backup, got ${JSON.stringify(result)}`);
    const snapshot = new Database(result.path, { readonly: true });
    const snapshotRows = (snapshot.prepare("SELECT count(*) AS n FROM t").get() as { n: number }).n;
    snapshot.close();

    const naiveCopy = path.join(tmpDir, "wal-naive.db");
    fs.copyFileSync(walDbFile, naiveCopy);
    const naive = new Database(naiveCopy, { readonly: true });
    const naiveRows = (naive.prepare("SELECT count(*) AS n FROM t").get() as { n: number }).n;
    naive.close();
    hot.close();

    assert(snapshotRows === 5_000, `the snapshot must hold every row, got ${snapshotRows}`);
    assert(
      naiveRows < snapshotRows,
      "the fixture no longer reproduces the bug: a plain copy saw every row, so the WAL was checkpointed",
    );
  });
});

describe("Utility scenes", () => {
  test("the four built-in scenes are seeded exactly once", () => {
    seedUtilityScenes(utilityRepo, settingsRepo);
    const seeded = utilityRepo.list();
    assert(
      seeded.length === DEFAULT_UTILITY_SCENES.length,
      `expected ${DEFAULT_UTILITY_SCENES.length} seeded scenes, got ${seeded.length}`,
    );
    assert(settingsRepo.get("utility.seeded"), "seeding must record that it happened");
    // The list order is the constant's order, without any reorder() having run.
    assert(
      seeded.map((scene) => scene.tool).join() === DEFAULT_UTILITY_SCENES.map((scene) => scene.tool).join(),
      "the seeded scenes must keep the order they are declared in",
    );

    seedUtilityScenes(utilityRepo, settingsRepo);
    assert(utilityRepo.list().length === seeded.length, "seeding twice must not duplicate anything");
  });

  test("deleting every scene does NOT bring them back on the next launch", () => {
    // The whole reason the flag exists rather than a row count: an operator
    // who deletes a scene must be rid of it.
    for (const scene of utilityRepo.list()) utilityRepo.delete(scene.id);
    assert(utilityRepo.isEmpty(), "the fixture must start this case with an empty table");
    seedUtilityScenes(utilityRepo, settingsRepo);
    assert(utilityRepo.isEmpty(), "an already-seeded database must never be re-seeded");
  });

  test("a scene round-trips through create, update and duplicate", () => {
    const created = utilityRepo.create({
      name: "  Cuenta 5  ",
      tool: "countdown",
      config: {
        durationMs: 5 * 60_000,
        targetMinuteOfDay: 9 * 60 + 30,
        endMessage: "¡Empezamos!",
        format: { hour12: false, showSeconds: true, hideZeroHours: true, overrun: true },
      },
      style: {
        version: 1,
        background: { kind: "gradient", from: "#04132b", to: "#2f557f", direction: "to-bottom" },
        fontFamily: "Futura",
        verticalAlign: "bottom",
        value: { sizeCqw: 24, color: "#ffffff", weight: 300, shadow: true },
        title: { sizeCqw: 4, color: "#84adfc", weight: 600, shadow: false },
        message: { sizeCqw: 4.5, color: "#f5f5f5", weight: 400, shadow: true },
        triggers: { warningAtMs: 60_000, warningColor: "#cd4900", endColor: "#d0021b" },
      },
      title: "El culto comienza en",
      message: null,
    });
    assert(created.name === "Cuenta 5", "the stored name must be trimmed");
    assert(created.style.background.kind === "gradient", "the background kind must survive the JSON round trip");
    assert(created.config.format.overrun, "the format flags must survive the JSON round trip");
    assert(created.style.triggers?.warningAtMs === 60_000, "the colour triggers must survive the JSON round trip");

    const { id: _id, ...fields } = created;
    const renamed = utilityRepo.update(created.id, { ...fields, name: "Cuenta 5 minutos", tool: "stopwatch" });
    assert(renamed.tool === "stopwatch", "the tool is a column and must be updatable");
    assert(renamed.style.fontFamily === "Futura", "an update must not lose the stored style");

    const copy = utilityRepo.duplicate(created.id, "Cuenta 5 (copia)");
    assert(copy.id !== created.id, "a duplicate must be its own row");
    assert(copy.style.verticalAlign === "bottom", "a duplicate must carry the style over");
    assert(utilityRepo.get(created.id)?.name === "Cuenta 5 minutos", "duplicating must not touch the source");
  });

  test("a new scene lands on top and reorder renormalizes the whole column", () => {
    const first = utilityRepo.list()[0]!;
    const newest = utilityRepo.create({ ...DEFAULT_UTILITY_SCENES[0]!, name: "Recién creada" });
    assert(utilityRepo.list()[0]?.id === newest.id, "a new scene must land at the top of the list");

    const reversed = utilityRepo.list().map((scene) => scene.id).reverse();
    const reordered = utilityRepo.reorder(reversed);
    assert(
      reordered.map((scene) => scene.id).join() === reversed.join(),
      "reorder must answer with the order it persisted",
    );
    assert(utilityRepo.list()[0]?.id === reversed[0], "the persisted order must survive a fresh list()");
    assert(reversed.includes(first.id), "the fixture must still hold the scene it started from");
  });

  test("a corrupt config or style falls back field by field instead of throwing", () => {
    const scene = utilityRepo.list()[0]!;
    // Hand-written rows are the real case: a truncated write, a version that
    // wrote a shape this build does not know, somebody editing the file.
    sqlite
      .prepare("UPDATE utility_scenes SET config_json = ?, style_json = ? WHERE id = ?")
      .run("{ not json", JSON.stringify({ version: 1, verticalAlign: "sideways", value: { sizeCqw: 18, color: "#ff0000", weight: 400, shadow: true } }), scene.id);

    const read = utilityRepo.get(scene.id);
    assert(read !== null, "a corrupt row must still come back as a scene");
    assert(read.config.durationMs > 0, "an unparseable config must fall back to the defaults");
    assert(read.style.verticalAlign === "middle", "an invalid enum must fall back to its default");
    // The half of the style that WAS valid is kept: falling back wholesale
    // would hand the operator back a scene they never built.
    assert(read.style.value.color === "#ff0000", "a valid field inside an invalid style must be preserved");
  });
});
