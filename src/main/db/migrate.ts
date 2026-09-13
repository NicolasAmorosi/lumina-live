import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import type { Db } from "./client";

/**
 * Whether `runMigrations` would actually apply anything.
 *
 * Drizzle's migrator compares each journal entry's `when` against the newest
 * `created_at` in `__drizzle_migrations`; this asks the same question without
 * running it. Opened as its own read-only connection because the caller runs
 * BEFORE `openDatabase` — the whole point is to decide about the file before
 * touching it.
 */
function hasPendingMigrations(dbFilePath: string, migrationsFolder: string): boolean {
  let journalMax: number;
  try {
    const journal = JSON.parse(
      fs.readFileSync(path.join(migrationsFolder, "meta", "_journal.json"), "utf-8"),
    ) as { entries?: { when: number }[] };
    const entries = journal.entries ?? [];
    if (entries.length === 0) return false;
    journalMax = Math.max(...entries.map((e) => e.when));
  } catch {
    // No journal we can read: assume the worst and take the backup.
    return true;
  }

  let applied: number;
  try {
    const sqlite = new Database(dbFilePath, { readonly: true });
    try {
      const row = sqlite
        .prepare(`SELECT MAX(created_at) AS max FROM __drizzle_migrations`)
        .get() as { max: number | null } | undefined;
      applied = row?.max ?? 0;
    } finally {
      sqlite.close();
    }
  } catch {
    // No migrations table yet (a database from before drizzle, or a file we
    // cannot open read-only) — treat as pending.
    return true;
  }

  return journalMax > applied;
}

/**
 * Copies the DB file before applying pending migrations, keeping the last 3.
 * A migration failing on a user's machine on a Sunday morning must be
 * recoverable — SQLite's DDL is transactional so a failed migration itself
 * rolls back, but this covers the case where the *result* is wrong in a way
 * that only shows up after commit.
 *
 * **Only when something is actually pending.** It used to copy the whole file
 * on EVERY launch, which cost a 10 MB `copyFileSync` before the window existed
 * — but far worse, the three kept slots were consumed by post-migration
 * copies: three ordinary launches after a migration and the pre-migration
 * snapshot, the only one this function exists to keep, had been rotated out.
 */
export function backupBeforeMigrate(
  dbFilePath: string,
  backupDir: string,
  migrationsFolder: string,
): void {
  if (!fs.existsSync(dbFilePath)) return;
  if (!hasPendingMigrations(dbFilePath, migrationsFolder)) return;
  fs.mkdirSync(backupDir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = path.join(backupDir, `worship-${stamp}.db`);
  fs.copyFileSync(dbFilePath, dest);

  const existing = fs
    .readdirSync(backupDir)
    .filter((f) => f.endsWith(".db"))
    .sort();
  for (const stale of existing.slice(0, Math.max(0, existing.length - 3))) {
    fs.unlinkSync(path.join(backupDir, stale));
  }
}

export function runMigrations(db: Db, migrationsFolder: string): void {
  migrate(db, { migrationsFolder });
}
