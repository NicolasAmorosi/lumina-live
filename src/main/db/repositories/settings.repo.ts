import { eq } from "drizzle-orm";
import type { Db } from "../client";
import { settings } from "../schema";
import { DEFAULT_SETTINGS, type SettingsMap } from "@shared/types/settings";

export class SettingsRepo {
  constructor(private readonly db: Db) {}

  getAll(): SettingsMap {
    const rows = this.db.select().from(settings).all();
    const result = { ...DEFAULT_SETTINGS };
    for (const row of rows) {
      if (row.key in result) {
        (result as Record<string, unknown>)[row.key] = JSON.parse(row.value);
      }
    }
    return result;
  }

  setMany(partial: Partial<SettingsMap>): void {
    const now = Date.now();
    for (const [key, value] of Object.entries(partial)) {
      this.db
        .insert(settings)
        .values({ key, value: JSON.stringify(value), updatedAt: now })
        .onConflictDoUpdate({
          target: settings.key,
          set: { value: JSON.stringify(value), updatedAt: now },
        })
        .run();
    }
  }

  get<K extends keyof SettingsMap>(key: K): SettingsMap[K] {
    const row = this.db.select().from(settings).where(eq(settings.key, key)).get();
    return row ? (JSON.parse(row.value) as SettingsMap[K]) : DEFAULT_SETTINGS[key];
  }
}
