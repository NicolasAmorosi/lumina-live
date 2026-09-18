import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { openDatabase } from "../../src/main/db/client";
import { runMigrations } from "../../src/main/db/migrate";
import { HistoryRepo } from "../../src/main/db/repositories/history.repo";

/** Mirrors `MAX_ROWS` in the repo, which is module-private on purpose. A test
 *  that imported it could not tell a changed cap from a broken prune. */
const MAX_ROWS = 5000;

const drizzleDir = path.join(process.cwd(), "drizzle");

let tmpDir: string;
let sqlite: ReturnType<typeof openDatabase>["sqlite"];
let db: ReturnType<typeof openDatabase>["db"];
let repo: HistoryRepo;

function insertRows(count: number): void {
  const stmt = sqlite.prepare(
    "INSERT INTO projection_history (projected_at, kind, snapshot_json) VALUES (?, 'image', '{}')",
  );
  const many = sqlite.transaction((n: number) => {
    for (let i = 0; i < n; i++) stmt.run(Date.now() + i);
  });
  many(count);
}

function count(): number {
  return (sqlite.prepare("SELECT count(*) AS n FROM projection_history").get() as { n: number }).n;
}

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "worship-history-prune-"));
  const opened = openDatabase(path.join(tmpDir, "history.db"));
  sqlite = opened.sqlite;
  db = opened.db;
  runMigrations(db, drizzleDir);
  repo = new HistoryRepo(db);
});

afterAll(() => {
  sqlite.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** The delete is a range scan (`id <= the MAX_ROWS-th newest id`), so the two
 *  cases that can go wrong are the boundary — off by one in either direction —
 *  and an under-full table, where the subquery yields NULL and `id <= NULL` is
 *  NULL for every row. A prune that emptied the history on a fresh install
 *  would be silent: nothing reads the table except the history view. */
describe("HistoryRepo.prune keeps exactly the newest MAX_ROWS", () => {
  test("deletes nothing while the table is under the cap", () => {
    insertRows(10);
    repo.prune();
    expect(count()).toBe(10);
  });

  test("deletes nothing at exactly the cap", () => {
    insertRows(MAX_ROWS - 10);
    expect(count()).toBe(MAX_ROWS);
    repo.prune();
    expect(count()).toBe(MAX_ROWS);
  });

  test("trims down to the cap and keeps the NEWEST rows", () => {
    insertRows(37);
    const maxId = (
      sqlite.prepare("SELECT max(id) AS id FROM projection_history").get() as { id: number }
    ).id;

    repo.prune();

    expect(count()).toBe(MAX_ROWS);
    const range = sqlite
      .prepare("SELECT min(id) AS lo, max(id) AS hi FROM projection_history")
      .get() as { lo: number; hi: number };
    expect(range.hi).toBe(maxId);
    expect(range.lo).toBe(maxId - MAX_ROWS + 1);
  });
});
