import { app, BrowserWindow, dialog } from "electron";
import fs from "node:fs";
import path from "node:path";
import { registerWorshipScheme, registerWorshipProtocolHandler } from "./protocol/worship-protocol";
import { openDatabase } from "./db/client";
import { backupBeforeMigrate, runMigrations } from "./db/migrate";
import { seedBuiltinBibles } from "./db/seed/seed-bible";
import { initRepos, getMediaRepo, getSettingsRepo } from "./services/repos";
import { migrateLegacyDataIfPresent } from "./services/migrate-legacy-data";
import { setBibleDb } from "./ipc/handlers/bible";
import { registerAllIpcHandlers } from "./ipc";
import { createControlWindow } from "./windows/control-window";
import { projectionState } from "./services/projection-state";
import { dbBackupDir, dbPath, biblesDir, migrationsDir, userDataDir } from "./paths";
import { preOpenPowerPoint, quitPowerPoint } from "./powerpoint/com";
import { cleanupSlideTempDirs } from "./ipc/handlers/ppt";

// Must run before app.whenReady().
registerWorshipScheme();

// Two instances writing the same SQLite file (and fighting over which one
// owns the projection window) is a real scenario — a user double-clicking
// the app icon, or a stray process left over from a crash. Refuse the
// second launch and focus the first instance's window instead.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

function initDatabase(): void {
  backupBeforeMigrate(dbPath, dbBackupDir);
  const { sqlite, db } = openDatabase(dbPath);

  try {
    runMigrations(db, migrationsDir);
  } catch (error) {
    dialog.showErrorBox(
      "Error al iniciar la base de datos",
      `No se pudieron aplicar las migraciones. Se conservó una copia de seguridad en\n${dbBackupDir}\n\n${String(error)}`,
    );
    throw error;
  }

  seedBuiltinBibles(db, sqlite, biblesDir);
  initRepos(db, sqlite);
  setBibleDb(db, sqlite);
  migrateLegacyDataIfPresent(getSettingsRepo(), getMediaRepo());
}

function wireMinimizeRestoreSync(controlWindow: BrowserWindow): void {
  // The projection window loses `alwaysOnTop` on some platforms when the OS
  // minimizes/restores its owning process — reasserted here on restore.
  controlWindow.on("minimize", () => projectionState.getWindow()?.minimize());
  controlWindow.on("restore", () => {
    const win = projectionState.getWindow();
    if (!win) return;
    win.restore();
    win.setAlwaysOnTop(true, "screen-saver");
  });
  controlWindow.on("closed", () => projectionState.getWindow()?.close());
}

let mainControlWindow: BrowserWindow | null = null;

app.on("second-instance", () => {
  if (mainControlWindow) {
    if (mainControlWindow.isMinimized()) mainControlWindow.restore();
    mainControlWindow.focus();
  }
});

if (gotSingleInstanceLock) {
  app.whenReady().then(async () => {
    try {
      initDatabase();
    } catch {
      app.quit();
      return;
    }

    registerWorshipProtocolHandler(getMediaRepo());
    registerAllIpcHandlers();

    void preOpenPowerPoint();

    mainControlWindow = createControlWindow();
    wireMinimizeRestoreSync(mainControlWindow);

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) mainControlWindow = createControlWindow();
    });
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  cleanupSlideTempDirs();
  void quitPowerPoint();
});

// Surface crashes as a dialog instead of a silent blank window — the health
// check the design doc calls for around the native SQLite module.
process.on("uncaughtException", (error) => {
  fs.appendFileSync(
    path.join(userDataDir, "crash.log"),
    `${new Date().toISOString()} ${error.stack ?? error}\n`,
  );
  dialog.showErrorBox("Error inesperado", String(error.stack ?? error));
});
