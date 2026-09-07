import { app } from "electron";
import path from "node:path";

/**
 * Single place that resolves every "where does X live" question so dev vs.
 * packaged never leaks into the rest of the main process. See package.json's
 * `build.extraResources` for how `migrations/` and `bibles/` land next to the
 * packaged app.
 */
const resourcesRoot = app.isPackaged ? process.resourcesPath : app.getAppPath();

export const migrationsDir = app.isPackaged
  ? path.join(resourcesRoot, "migrations")
  : path.join(app.getAppPath(), "drizzle");

export const biblesDir = app.isPackaged
  ? path.join(resourcesRoot, "bibles")
  : path.join(app.getAppPath(), "resources/bibles");

export const userDataDir = app.getPath("userData");
export const dbPath = path.join(userDataDir, "worship.db");
export const dbBackupDir = path.join(userDataDir, "backups");
export const legacySettingsPath = path.join(userDataDir, "settings.json");
export const legacyMediaLibraryPath = path.join(userDataDir, "media_library.json");

/** Persistent, content-addressed cache of converted PowerPoint/Impress decks
 *  (rasterized slide images + extracted audio) — see src/main/slides/. Never
 *  os.tmpdir(): that's what the COM-era exporter used and why its cache was
 *  lost on every restart. */
export const slidesCacheDir = path.join(userDataDir, "slides-cache");
/** Conversions in progress land here first; only fs.renameSync'd into their
 *  final deckCacheDir() once every file is written. Swept clean on startup. */
export const slidesTempDir = path.join(slidesCacheDir, ".tmp");
/** Dedicated LibreOffice UserInstallation — isolates our headless soffice
 *  from any copy the user runs as a normal GUI app. */
export const sofficeProfileDir = path.join(userDataDir, "soffice-profile");

export function deckCacheDir(contentHash: string, renderWidth: number, imageFormat: string): string {
  return path.join(slidesCacheDir, `${contentHash.slice(0, 16)}-${renderWidth}-${imageFormat}`);
}
