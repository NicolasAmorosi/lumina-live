/**
 * `MediaRepo.relocate` onto a file the library already has a row for.
 *
 * The normal case, not an edge one: most of a real library comes from linked
 * folders, so once a drive comes back under another letter and its folder is
 * re-linked, the file the operator relocates a missing item to is already a
 * row. That used to break `ux_media_path`'s UNIQUE. Now the two rows merge into
 * the one the schedule references, and nothing that pointed at either is lost.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { openDatabase } from "../../src/main/db/client";
import { runMigrations } from "../../src/main/db/migrate";
import { MediaRepo } from "../../src/main/db/repositories/media.repo";
import { ProgramsRepo } from "../../src/main/db/repositories/programs.repo";
import { OverlaysRepo } from "../../src/main/db/repositories/overlays.repo";
import { DEFAULT_PLATE_STYLE } from "../../src/shared/types/overlay";

let dir: string;
let handle: ReturnType<typeof openDatabase>;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "worship-relocate-"));
  handle = openDatabase(path.join(dir, "worship.db"));
  runMigrations(handle.db, path.join(process.cwd(), "drizzle"));
});

afterAll(() => {
  handle.sqlite.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("relocating onto a file the library already has merges the two rows", () => {
  const media = new MediaRepo(handle.db, handle.sqlite);
  const programs = new ProgramsRepo(handle.db, handle.sqlite);
  const plates = new OverlaysRepo(handle.db, handle.sqlite);

  const oldPath = path.join(dir, "E", "logo.png");
  const newPath = path.join(dir, "F", "logo.png");
  for (const file of [oldPath, newPath]) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "png");
  }
  const original = media.upsertFromPath(oldPath, "image", true);
  // The re-linked folder registered the same file at its new letter.
  const duplicate = media.upsertFromPath(newPath, "image", false);
  fs.rmSync(oldPath);

  const program = programs.save({
    name: "Culto",
    items: [
      { kind: "media", mediaAssetId: original.id, title: null },
      { kind: "media", mediaAssetId: duplicate.id, title: null },
    ],
  });
  const plate = plates.create({
    name: "Mosca",
    kind: "bug",
    position: "top-right",
    title: null,
    subtitle: null,
    imageAssetId: duplicate.id,
    style: DEFAULT_PLATE_STYLE,
  });

  const relocated = media.relocate(original.id, newPath);

  expect(relocated).toMatchObject({ id: original.id, path: newPath, inLibrary: true, missingSince: null });
  expect(media.getById(duplicate.id)).toBeNull();
  expect(programs.load(program.id).items.map((item) => (item.kind === "media" ? item.mediaAssetId : null))).toEqual([
    original.id,
    original.id,
  ]);
  expect(plates.list().find((p) => p.id === plate.id)?.imageAssetId).toBe(original.id);
});
