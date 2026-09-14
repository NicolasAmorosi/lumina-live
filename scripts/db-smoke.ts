/**
 * Standalone smoke test for the data layer — runs without Electron so the DB,
 * migrations and Bible seed can be verified before any UI exists. Creates a
 * throwaway DB file under scratch/, never touches userData.
 */
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { openDatabase } from "../src/main/db/client";
import { backupBeforeMigrate, runMigrations } from "../src/main/db/migrate";
import { seedBuiltinBibles } from "../src/main/db/seed/seed-bible";
import { mediaAssets } from "../src/main/db/schema";
import { BibleRepo } from "../src/main/db/repositories/bible.repo";
import { SettingsRepo } from "../src/main/db/repositories/settings.repo";
import { ProgramsRepo } from "../src/main/db/repositories/programs.repo";
import { MediaRepo } from "../src/main/db/repositories/media.repo";
import { SlidesRepo } from "../src/main/db/repositories/slides.repo";
import { DraftRepo } from "../src/main/db/repositories/draft.repo";
import { initRepos } from "../src/main/services/repos";
import { readBinarySlideTimings } from "../src/main/slides/ppt-binary-timings";
import { backfillDeckTimings } from "../src/main/slides/backfill-timings";
import { SNIPPET_MARK_END, SNIPPET_MARK_START, parseSnippet } from "../src/shared/types/bible";
import { SETTINGS_VALIDATORS, isSettingsKey } from "../src/shared/types/settings";
import Database from "better-sqlite3";

const scratchDir = path.join(process.cwd(), ".scratch");
fs.mkdirSync(scratchDir, { recursive: true });
const dbFile = path.join(scratchDir, "smoke.db");
fs.rmSync(dbFile, { force: true });
fs.rmSync(`${dbFile}-wal`, { force: true });
fs.rmSync(`${dbFile}-shm`, { force: true });

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
}


/**
 * A minimal OLE2 compound file carrying a PowerPoint 97 record stream with two
 * slides: the first auto-advances after 12345 ms, the second does not (its
 * `fAutoAdvance` bit is clear, with a stale `slideTime` left behind — exactly
 * what PowerPoint writes when the box is unticked).
 *
 * Built rather than checked in so the reader has a deterministic fixture that
 * costs no binary in the repo, and so the structures it depends on are spelled
 * out here: the persist directory, the slide list that defines PRESENTATION
 * order, and the `SlideShowSlideInfoAtom` flag layout.
 *
 * Both streams are padded to `miniCutoff` so they live in ordinary sectors —
 * the mini-FAT is not what this is testing.
 */
function buildLegacyPpt(): Buffer {
  const SECTOR = 512;
  const STREAM_BYTES = 4096;
  const ENDOFCHAIN = 0xfffffffe;
  const FREESECT = 0xffffffff;
  const FATSECT = 0xfffffffd;
  const NOSTREAM = 0xffffffff;

  const header = (recVer: number, recInstance: number, recType: number, len: number): Buffer => {
    const buf = Buffer.alloc(8);
    buf.writeUInt16LE((recInstance << 4) | recVer, 0);
    buf.writeUInt16LE(recType, 2);
    buf.writeUInt32LE(len, 4);
    return buf;
  };

  const slidePersistAtom = (persistId: number, slideId: number): Buffer => {
    const body = Buffer.alloc(20);
    body.writeUInt32LE(persistId, 0);
    body.writeUInt32LE(slideId, 12);
    return Buffer.concat([header(0x0, 0, 0x03f3, body.length), body]);
  };

  const slideContainer = (slideTimeMs: number, flags: number): Buffer => {
    const info = Buffer.alloc(16);
    info.writeInt32LE(slideTimeMs, 0); // slideTime
    info.writeUInt16LE(flags, 10); // fFlags
    const atom = Buffer.concat([header(0x0, 0, 0x03f9, info.length), info]);
    return Buffer.concat([header(0xf, 0, 0x03ee, atom.length), atom]);
  };

  const slideList = Buffer.concat([slidePersistAtom(2, 256), slidePersistAtom(3, 257)]);
  const document = Buffer.concat([
    header(0xf, 0, 0x0ff0, slideList.length), // SlideListWithText, recInstance 0 = slides
    slideList,
  ]);
  const documentContainer = Buffer.concat([
    header(0xf, 0, 0x03e8, document.length),
    document,
  ]);

  // 0x0400 = fAutoAdvance, 0x0001 = fManualAdvance. Not consecutive bits.
  const slide1 = slideContainer(12_345, 0x0400);
  const slide2 = slideContainer(999, 0x0001);

  const documentOffset = 0;
  const slide1Offset = documentContainer.length;
  const slide2Offset = slide1Offset + slide1.length;
  const persistOffset = slide2Offset + slide2.length;

  // One run of three ids starting at 1: document, slide 1, slide 2.
  const persistBody = Buffer.alloc(4 + 3 * 4);
  persistBody.writeUInt32LE(1 | (3 << 20), 0);
  persistBody.writeUInt32LE(documentOffset, 4);
  persistBody.writeUInt32LE(slide1Offset, 8);
  persistBody.writeUInt32LE(slide2Offset, 12);
  const persistDirectory = Buffer.concat([
    header(0x0, 0, 0x1772, persistBody.length),
    persistBody,
  ]);

  const editOffset = persistOffset + persistDirectory.length;
  const editBody = Buffer.alloc(28);
  editBody.writeUInt32LE(257, 0); // lastSlideIdRef
  editBody.writeUInt32LE(0, 8); // offsetLastEdit — no earlier edit
  editBody.writeUInt32LE(persistOffset, 12);
  editBody.writeUInt32LE(1, 16); // docPersistIdRef
  editBody.writeUInt32LE(4, 20); // persistIdSeed
  const userEdit = Buffer.concat([header(0x0, 0, 0x0ff5, editBody.length), editBody]);

  const docStream = Buffer.alloc(STREAM_BYTES);
  Buffer.concat([documentContainer, slide1, slide2, persistDirectory, userEdit]).copy(docStream);

  const userStream = Buffer.alloc(STREAM_BYTES);
  header(0x0, 0, 0x0ff6, 0x14).copy(userStream, 0); // CurrentUserAtom
  userStream.writeUInt32LE(0x14, 8); // size
  userStream.writeUInt32LE(0xf3d1c4df, 12); // headerToken (unencrypted)
  userStream.writeUInt32LE(editOffset, 16); // offsetToCurrentEdit

  const docSectors = STREAM_BYTES / SECTOR;
  const docStart = 2;
  const userStart = docStart + docSectors;
  const totalSectors = userStart + docSectors;

  const fat = Buffer.alloc(SECTOR, 0xff);
  for (let i = 0; i < SECTOR / 4; i++) fat.writeUInt32LE(FREESECT, i * 4);
  fat.writeUInt32LE(FATSECT, 0 * 4);
  fat.writeUInt32LE(ENDOFCHAIN, 1 * 4); // the directory, one sector
  for (let i = 0; i < docSectors; i++) {
    fat.writeUInt32LE(i === docSectors - 1 ? ENDOFCHAIN : docStart + i + 1, (docStart + i) * 4);
    fat.writeUInt32LE(i === docSectors - 1 ? ENDOFCHAIN : userStart + i + 1, (userStart + i) * 4);
  }

  const directory = Buffer.alloc(SECTOR);
  const writeEntry = (
    index: number,
    name: string,
    type: number,
    left: number,
    right: number,
    child: number,
    start: number,
    size: number,
  ): void => {
    const offset = index * 128;
    const encoded = Buffer.from(`${name}\0`, "utf16le");
    encoded.copy(directory, offset);
    directory.writeUInt16LE(encoded.length, offset + 64);
    directory.writeUInt8(type, offset + 66);
    directory.writeUInt8(1, offset + 67); // colour: black
    directory.writeUInt32LE(left, offset + 68);
    directory.writeUInt32LE(right, offset + 72);
    directory.writeUInt32LE(child, offset + 76);
    directory.writeUInt32LE(start, offset + 116);
    directory.writeUInt32LE(size, offset + 120);
  };
  writeEntry(0, "Root Entry", 5, NOSTREAM, NOSTREAM, 1, ENDOFCHAIN, 0);
  writeEntry(1, "PowerPoint Document", 2, NOSTREAM, 2, NOSTREAM, docStart, STREAM_BYTES);
  writeEntry(2, "Current User", 2, NOSTREAM, NOSTREAM, NOSTREAM, userStart, STREAM_BYTES);

  const head = Buffer.alloc(SECTOR);
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(head, 0);
  head.writeUInt16LE(0x003e, 24); // minor version
  head.writeUInt16LE(0x0003, 26); // major version
  head.writeUInt16LE(0xfffe, 28); // byte order
  head.writeUInt16LE(9, 30); // sector shift -> 512
  head.writeUInt16LE(6, 32); // mini sector shift -> 64
  head.writeUInt32LE(1, 44); // FAT sectors
  head.writeUInt32LE(1, 48); // directory start
  head.writeUInt32LE(4096, 56); // mini stream cutoff
  head.writeUInt32LE(ENDOFCHAIN, 60); // mini FAT start
  head.writeUInt32LE(0, 64);
  head.writeUInt32LE(ENDOFCHAIN, 68); // DIFAT start
  head.writeUInt32LE(0, 72);
  for (let i = 0; i < 109; i++) head.writeUInt32LE(i === 0 ? 0 : FREESECT, 76 + i * 4);

  const body = Buffer.alloc(totalSectors * SECTOR);
  fat.copy(body, 0);
  directory.copy(body, SECTOR);
  docStream.copy(body, docStart * SECTOR);
  userStream.copy(body, userStart * SECTOR);
  return Buffer.concat([head, body]);
}

async function main() {
  console.log("[1/18] Opening database…");
  const { sqlite, db } = openDatabase(dbFile);

  console.log("[2/18] Running migrations…");
  runMigrations(db, path.join(process.cwd(), "drizzle"));

  console.log("[3/18] Seeding builtin Bible…");
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

  console.log("[4/18] Chapter lookup…");
  const genesis1 = bibleRepo.getChapter(books[0]!.id, 1);
  assert(genesis1.length === 31, `expected 31 verses in Génesis 1, got ${genesis1.length}`);

  console.log("[5/18] FTS5 search (accent-insensitive)…");
  const hits = bibleRepo.search(versions[0]!.id, "espiritu");
  assert(hits.length > 0, "expected FTS search for 'espiritu' to match 'Espíritu'");
  console.log(`      "espiritu" -> ${hits.length} hits, first: ${hits[0]!.bookName} ${hits[0]!.chapter}:${hits[0]!.verse}`);

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

  console.log("[6/18] Settings + programs round-trip…");
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

  console.log("[7/18] Favorite round-trip…");
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

  console.log("[8/18] Manual list order…");
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

  console.log("[9/18] Media library batch import…");
  const mediaDir = path.join(scratchDir, "media");
  fs.rmSync(mediaDir, { recursive: true, force: true });
  fs.mkdirSync(mediaDir, { recursive: true });
  const filePaths = Array.from({ length: 25 }, (_, i) => {
    const p = path.join(mediaDir, `deck-${i}.pptx`);
    fs.writeFileSync(p, `fake pptx ${i}`);
    return p;
  });

  const mediaRepo = new MediaRepo(db, sqlite);
  const statted = filePaths.map((p) => ({ path: p, stat: fs.statSync(p) }));
  const { assets: inserted, mutated: insertedMutated } = mediaRepo.upsertBatch(statted, "ppt", true);
  assert(inserted.length === 25, `expected 25 inserted assets, got ${inserted.length}`);
  assert(insertedMutated === 25, `a fresh import of 25 new files should report 25 mutated, got ${insertedMutated}`);
  assert(
    inserted.every((a) => a.linkedAudioPath === null),
    "a fresh import must never resolve linked audio eagerly",
  );
  assert(
    mediaRepo.list("ppt").length === 25,
    `expected 25 ppt assets in the library, got ${mediaRepo.list("ppt").length}`,
  );

  console.log("[10/18] Stable re-import: unchanged files report zero mutations…");
  // This is the regression test for the import→library-changed→listFolder
  // loop: a `library:listFolder` re-scan of an untouched folder must be able
  // to tell "nothing to broadcast" from "something changed", or it will
  // broadcast `library-changed` and re-trigger itself forever.
  const { assets: restatted, mutated: stableMutated } = mediaRepo.upsertBatch(statted, "ppt", true);
  assert(restatted.length === 25, "a stable re-import must still return every asset");
  assert(stableMutated === 0, `re-importing unchanged files should mutate nothing, got ${stableMutated}`);

  console.log("[11/18] Batch re-import: reactivation is OR, not overwrite…");
  // Deactivate one row directly (simulating "no longer in the library, but
  // still on disk") before re-importing the same files.
  const [firstAsset] = inserted;
  db.update(mediaAssets).set({ inLibrary: 0 }).where(eq(mediaAssets.id, firstAsset!.id)).run();

  const { assets: reimported, mutated: reimportedMutated } = mediaRepo.upsertBatch(statted, "ppt", true);
  assert(reimported.length === 25, "re-import must return the same count");
  assert(reimportedMutated === 1, `only the deactivated row should count as mutated, got ${reimportedMutated}`);
  const reactivated = reimported.find((a) => a.id === firstAsset!.id);
  assert(reactivated?.inLibrary === true, "re-importing with inLibrary:true must reactivate a deactivated row");

  console.log("[12/18] Re-import of a CHANGED file returns the new size/mtime…");
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

  console.log("[13/18] Sweep: missing/reappeared files…");
  fs.rmSync(filePaths[0]!);
  const changedOnMissing = await mediaRepo.sweep();
  assert(changedOnMissing.has("ppt"), "sweep must report 'ppt' changed when a ppt file goes missing");
  const afterMissing = mediaRepo.getById(firstAsset!.id);
  assert(afterMissing?.missingSince !== null, "sweep must mark a vanished file's row as missing");

  fs.writeFileSync(filePaths[0]!, "fake pptx 0 restored");
  const changedOnReappear = await mediaRepo.sweep();
  assert(changedOnReappear.has("ppt"), "sweep must report 'ppt' changed when a missing file reappears");
  const afterReappear = mediaRepo.getById(firstAsset!.id);
  assert(afterReappear?.missingSince === null, "sweep must clear missingSince once the file is back");

  console.log("[14/18] Deck status is answered by CONTENT, not by row ownership…");
  // The regression test for `N3` (media-chain audit §5.2). The deck cache is
  // content-addressed, but `statusesByAsset` used to ask "which deck row does
  // this asset OWN?" — and `relinkDeck` MOVES that ownership. With the same
  // file present twice (every hymn in the library that motivated this is), one
  // asset held the row and the other reported "pending" forever: 555 of 1235
  // assets offered for conversion with zero work to do, and a count that
  // oscillated instead of reaching zero, because preparing one folder stole
  // the rows back from the other.
  const slidesRepo = new SlidesRepo(db, sqlite);
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
  const [dupA, dupB] = dupAssets;
  assert(dupA && dupB, "both duplicate copies must import as their own assets");

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
  const deckId = slidesRepo.insertDeck(
    {
      contentHash: dupHash,
      renderWidth: 1920,
      imageFormat: "webp",
      converterVersion: 1,
      mediaAssetId: dupA.id,
      sourcePath: dupA.path,
      sourceSizeBytes: dupStat.size,
      sourceMtimeMs: Math.trunc(dupStat.mtimeMs),
      cacheDir: path.join(scratchDir, "deck-dup"),
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

  // Opening the second copy relinks the row to it. The first must not regress
  // to "pending" — that swap is what made the count oscillate.
  const dupBStat = fs.statSync(dupB.path);
  slidesRepo.relinkDeck(deckId, dupB.id, dupB.path, dupBStat.size, Math.trunc(dupBStat.mtimeMs));
  const afterRelink = slidesRepo.statusesByAsset([dupA.id, dupB.id]);
  assert(
    afterRelink.get(dupA.id)?.status === "ready" && afterRelink.get(dupB.id)?.status === "ready",
    "relinking the row to one copy must not make the other look unconverted",
  );

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


  console.log("[15/18] Auto-advance survives the LibreOffice round-trip that drops it…");
  // The regression test for the auto-advance loss (media-chain audit §11).
  // LibreOffice's PPTX export only writes `<p:transition>` when the slide has
  // a visual EFFECT, and `advTm` is an attribute of that element — so a slide
  // set to "no transition, advance after 27 s" comes out of the round-trip
  // with no timing at all. 222 of the user's 1226 hymnal decks are affected.
  // The fix re-reads the times from the source binary; this builds a minimal
  // OLE2 `.ppt` so that reader is exercised without shipping a real deck.
  const legacyPath = path.join(mediaDir, "legacy-timings.ppt");
  fs.writeFileSync(legacyPath, buildLegacyPpt());

  const binaryTimings = readBinarySlideTimings(legacyPath);
  assert(binaryTimings !== null, "the synthetic legacy .ppt must parse");
  assert(binaryTimings!.length === 2, `expected 2 slides, got ${binaryTimings!.length}`);
  assert(
    binaryTimings![0]!.autoAdvanceMs === 12345,
    `slide 1 must carry its auto-advance time, got ${String(binaryTimings![0]!.autoAdvanceMs)}`,
  );
  assert(
    binaryTimings![1]!.autoAdvanceMs === null,
    "slide 2 has fAutoAdvance clear, so its stale slideTime must be ignored",
  );

  // End to end through the backfill: a deck already converted, both slides
  // with a NULL advance_ms, gets the times written back with no reconversion.
  initRepos(db, sqlite);
  const legacyStat = fs.statSync(legacyPath);
  const legacyAsset = mediaRepo.upsertFromPath(legacyPath, "ppt", true);
  const legacySlide = (slideIndex: number) => ({
    slideIndex,
    imageFile: `${slideIndex}.webp`,
    thumbFile: `${slideIndex}.thumb.webp`,
    widthPx: 1920,
    heightPx: 1080,
    bytes: 1024,
    advanceMs: null,
    advanceOnClick: true,
    transitionMs: null,
    hidden: false,
    title: null,
    notes: null,
  });
  const legacyDeckId = slidesRepo.insertDeck(
    {
      contentHash: "1".repeat(64),
      renderWidth: 1920,
      imageFormat: "webp",
      converterVersion: 1,
      mediaAssetId: legacyAsset.id,
      sourcePath: legacyPath,
      sourceSizeBytes: legacyStat.size,
      sourceMtimeMs: Math.trunc(legacyStat.mtimeMs),
      cacheDir: path.join(scratchDir, "deck-legacy"),
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
      cacheDir: path.join(scratchDir, "deck-legacy-disagree"),
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
      cacheDir: path.join(scratchDir, "deck-legacy-stale"),
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

  console.log("[16/18] Unsaved-schedule draft: round-trip and dead-reference filtering…");
  const draftRepo = new DraftRepo(db);
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
      { kind: "text", body: "Anuncio", title: null },
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

  // One row, always: saving twice replaces rather than accumulates.
  draftRepo.save({ programId: 1, name: "Otro", notes: "n", items: [], updatedAt: Date.now() });
  const second = draftRepo.load();
  assert(second?.name === "Otro" && second.programId === 1, "the draft row must be replaced, not appended");
  draftRepo.clear();
  assert(draftRepo.load() === null, "clearing the draft must leave nothing behind");

  console.log("[17/18] settings:set validators reject what the types cannot…");
  assert(!isSettingsKey("ui.themee"), "an unknown settings key must be rejected");
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

  console.log("[18/18] Pre-migration backup is WAL-aware…");
  // The failure this replaces: `fs.copyFileSync` of a WAL database copies only
  // the main file, so every transaction since the last checkpoint is silently
  // missing — exactly the state a dirty shutdown or a power cut leaves behind,
  // which is when the backup is the only thing standing between the operator
  // and a lost library.
  const walDbFile = path.join(scratchDir, "wal-backup.db");
  const walBackupDir = path.join(scratchDir, "wal-backup-dir");
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${walDbFile}${suffix}`, { force: true });
  fs.rmSync(walBackupDir, { recursive: true, force: true });

  const hot = new Database(walDbFile);
  hot.pragma("journal_mode = WAL");
  hot.exec("CREATE TABLE t (n INTEGER)");
  const insertRow = hot.prepare("INSERT INTO t VALUES (?)");
  for (let i = 0; i < 5_000; i += 1) insertRow.run(i);
  const walBytes = fs.statSync(`${walDbFile}-wal`).size;
  assert(walBytes > 0, "the fixture must leave an un-checkpointed WAL behind");
  // Left deliberately open: closing would checkpoint, which is the one case
  // the old implementation did get right.

  const result = backupBeforeMigrate(walDbFile, walBackupDir, path.join(process.cwd(), "drizzle"));
  assert(result.status === "ok", `expected a verified backup, got ${JSON.stringify(result)}`);
  const snapshot = new Database(result.path, { readonly: true });
  const snapshotRows = (snapshot.prepare("SELECT count(*) AS n FROM t").get() as { n: number }).n;
  snapshot.close();

  const naiveCopy = path.join(scratchDir, "wal-naive.db");
  fs.copyFileSync(walDbFile, naiveCopy);
  const naive = new Database(naiveCopy, { readonly: true });
  const naiveRows = (naive.prepare("SELECT count(*) AS n FROM t").get() as { n: number }).n;
  naive.close();
  hot.close();

  assert(snapshotRows === 5_000, `the snapshot must hold every row, got ${snapshotRows}`);
  console.log(`      WAL ${walBytes} B · VACUUM INTO ${snapshotRows} rows · plain copy ${naiveRows} rows`);
  assert(
    naiveRows < snapshotRows,
    "the fixture no longer reproduces the bug: a plain copy saw every row, so the WAL was checkpointed",
  );

  sqlite.close();
  console.log("\nAll checks passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
