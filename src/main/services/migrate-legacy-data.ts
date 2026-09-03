import fs from "node:fs";
import { legacySettingsPath, legacyMediaLibraryPath } from "../paths";
import type { SettingsRepo } from "../db/repositories/settings.repo";
import type { MediaRepo } from "../db/repositories/media.repo";

type LegacySettings = { logoPath?: string | null; lastFolder?: string | null };
type LegacyMediaLibrary = {
  videos?: { path: string }[];
  images?: { path: string }[];
  audios?: { path: string }[];
};

/**
 * One-shot import of the pre-migration `settings.json` / `media_library.json`
 * (docs/knowledge/05-data-and-persistence.md in the legacy app) into SQLite.
 * Renames the source files to `*.migrated` afterwards so this never runs
 * twice and the originals stay around as a safety net.
 */
export function migrateLegacyDataIfPresent(settingsRepo: SettingsRepo, mediaRepo: MediaRepo): void {
  if (fs.existsSync(legacySettingsPath)) {
    try {
      const legacy = JSON.parse(fs.readFileSync(legacySettingsPath, "utf-8")) as LegacySettings;
      settingsRepo.setMany({
        "logo.path": legacy.logoPath ?? null,
        "files.lastFolder": legacy.lastFolder ?? null,
      });
      fs.renameSync(legacySettingsPath, `${legacySettingsPath}.migrated`);
    } catch {
      // A corrupt legacy file shouldn't block startup; the app just starts with defaults.
    }
  }

  if (fs.existsSync(legacyMediaLibraryPath)) {
    try {
      const legacy = JSON.parse(fs.readFileSync(legacyMediaLibraryPath, "utf-8")) as LegacyMediaLibrary;
      const kinds: [keyof LegacyMediaLibrary, "video" | "image" | "audio"][] = [
        ["videos", "video"],
        ["images", "image"],
        ["audios", "audio"],
      ];
      for (const [key, kind] of kinds) {
        for (const entry of legacy[key] ?? []) {
          if (fs.existsSync(entry.path)) mediaRepo.upsertFromPath(entry.path, kind, true);
        }
      }
      fs.renameSync(legacyMediaLibraryPath, `${legacyMediaLibraryPath}.migrated`);
    } catch {
      // Same as above — best effort, never blocks startup.
    }
  }
}
