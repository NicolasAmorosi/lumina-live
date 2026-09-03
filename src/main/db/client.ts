import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

export type Db = ReturnType<typeof drizzle<typeof schema>>;

/**
 * Opens (or creates) the SQLite file at `filePath` with the pragmas this app
 * relies on. `foreignKeys` must be set on every connection — SQLite does not
 * persist it in the file. Exported as a function (not a singleton) so the
 * db-smoke script and tests can each get an isolated instance.
 */
export function openDatabase(filePath: string): { sqlite: Database.Database; db: Db } {
  const sqlite = new Database(filePath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("synchronous = NORMAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  sqlite.pragma("temp_store = MEMORY");
  const db = drizzle(sqlite, { schema });
  return { sqlite, db };
}
