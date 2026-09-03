import fs from "node:fs";
import path from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import type { Db } from "./client";

/**
 * Copies the DB file (+ WAL/SHM sidecars) before applying pending migrations,
 * keeping the last 3. A migration failing on a user's machine on a Sunday
 * morning must be recoverable — SQLite's DDL is transactional so a failed
 * migration itself rolls back, but this covers the case where the *result*
 * is wrong in a way that only shows up after commit.
 */
export function backupBeforeMigrate(dbFilePath: string, backupDir: string): void {
  if (!fs.existsSync(dbFilePath)) return;
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
