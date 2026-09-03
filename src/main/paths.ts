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
export const thumbsDir = path.join(userDataDir, "thumbs");
export const legacySettingsPath = path.join(userDataDir, "settings.json");
export const legacyMediaLibraryPath = path.join(userDataDir, "media_library.json");
