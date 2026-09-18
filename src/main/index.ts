import { app, BrowserWindow, dialog } from "electron";
import fs from "node:fs";
import path from "node:path";
import { registerWorshipScheme, registerWorshipProtocolHandler } from "./protocol/worship-protocol";
import { openDatabase } from "./db/client";
import { backupBeforeMigrate, runMigrations } from "./db/migrate";
import { seedBuiltinBibles } from "./db/seed/seed-bible";
import { seedUtilityScenes } from "./db/seed/seed-utility-scenes";
import {
  initRepos,
  closeDatabase,
  getHistoryRepo,
  getMediaRepo,
  getSettingsRepo,
  getUtilityRepo,
} from "./services/repos";
import {
  migrateLegacySettingsIfPresent,
  migrateLegacyMediaIfPresent,
} from "./services/migrate-legacy-data";
import { setBibleDb } from "./ipc/handlers/bible";
import { registerAllIpcHandlers } from "./ipc";
import { createControlWindow } from "./windows/control-window";
import { installNavigationGuards } from "./windows/navigation-guards";
import { installApplicationMenu } from "./windows/app-menu";
import { installCloseGuard, markQuitRequested } from "./windows/close-guard";
import { projectionState } from "./services/projection-state";
import { dbBackupDir, dbPath, biblesDir, migrationsDir, userDataDir } from "./paths";
import { initSlidesSubsystem, shutdownSlides } from "./slides/deck-service";
import { isRasterizerWindow } from "./slides/rasterizer";
import { startLibrarySweepScheduler } from "./services/library-sweeper";
import { pruneThumbCache } from "./media/thumbnail-service";
import { backfillContentHashes } from "./media/content-hash";
import { backfillDeckTimings } from "./slides/backfill-timings";

/** Long enough to be safely past the first paint of the control window — the
 *  prune walks a directory and is worth nothing compared to the app being on
 *  screen. */
const THUMB_PRUNE_DELAY_MS = 10_000;

/** Shorter than the thumbnail prune: this one changes what the library grid
 *  SHOWS (a tile's badge and its first-slide thumbnail), so the operator
 *  should not have to wait ten seconds to see the truth — but still long
 *  enough to be past the control window's first paint. */
const CONTENT_HASH_BACKFILL_DELAY_MS = 2_000;

// Must run before app.whenReady().
registerWorshipScheme();

// Every window this app will ever create — control, projection, and the
// offscreen rasterizer — hardened from one place, before any of them exists.
// Registering it per-window instead would mean remembering to do it in the
// next `new BrowserWindow`, which is exactly the kind of thing that gets
// forgotten. See `windows/navigation-guards.ts` for what it stops.
app.on("web-contents-created", (_event, contents) => installNavigationGuards(contents));

// Two instances writing the same SQLite file (and fighting over which one
// owns the projection window) is a real scenario — a user double-clicking
// the app icon, or a stray process left over from a crash. Refuse the
// second launch and focus the first instance's window instead.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

function initDatabase(): void {
  // Kept and reported rather than assumed: the error box below used to promise
  // a backup unconditionally, which on the one morning it matters sends the
  // operator looking for a file that may not be there.
  const backup = backupBeforeMigrate(dbPath, dbBackupDir, migrationsDir);
  if (backup.status === "failed") console.warn("[db] pre-migration backup failed:", backup.reason);

  const { sqlite, db } = openDatabase(dbPath);

  try {
    runMigrations(db, migrationsDir);
  } catch (error) {
    dialog.showErrorBox(
      "Error al iniciar la base de datos",
      [
        "No se pudieron aplicar las migraciones.",
        backup.status === "ok"
          ? `Se conservó una copia de seguridad verificada en\n${backup.path}`
          : "No hay una copia de seguridad previa a esta migración.",
        String(error),
      ].join("\n\n"),
    );
    throw error;
  }

  seedBuiltinBibles(db, sqlite, biblesDir);
  initRepos(db, sqlite);
  setBibleDb(db, sqlite);
  migrateLegacySettingsIfPresent(getSettingsRepo());
  // After `initRepos`, unlike the Bible seed above: this one needs two
  // repositories rather than a raw handle, and the flag it reads lives in
  // `settings`.
  seedUtilityScenes(getUtilityRepo(), getSettingsRepo());
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

/** Every window the operator can actually see — i.e. not the offscreen
 *  rasterizer, which is a real `BrowserWindow` and would otherwise make the
 *  app look "still open" for the 60s its idle timer keeps it alive after a
 *  conversion. */
function userFacingWindows(): BrowserWindow[] {
  return BrowserWindow.getAllWindows().filter((win) => !isRasterizerWindow(win));
}

/** Creates the control window and wires everything that must follow it.
 *
 *  A single entry point on purpose: `app.on("activate")` used to call
 *  `createControlWindow()` directly, which quietly skipped
 *  `wireMinimizeRestoreSync` — so after closing and reopening the app on
 *  macOS, minimizing no longer took the projection down with it and closing
 *  the control window left the projector on screen. */
function openControlWindow(): BrowserWindow {
  const win = createControlWindow();
  wireMinimizeRestoreSync(win);
  // Vetoes the first close and asks the control window instead — the unsaved
  // schedule is the renderer's to speak for. See `close-guard.ts`.
  installCloseGuard(win);
  win.on("closed", () => {
    // `window-all-closed` only fires when NO window is left, rasterizer
    // included — so on Windows/Linux a recent conversion could leave the app
    // running with no visible window at all. Deciding it here, against the
    // user-facing count, is what actually ends the process.
    if (process.platform !== "darwin" && userFacingWindows().length === 0) app.quit();
  });
  return win;
}

let mainControlWindow: BrowserWindow | null = null;

app.on("second-instance", () => {
  if (mainControlWindow) {
    if (mainControlWindow.isMinimized()) mainControlWindow.restore();
    mainControlWindow.focus();
  }
});

if (gotSingleInstanceLock) {
  void app.whenReady().then(() => {
    try {
      initDatabase();
    } catch {
      app.quit();
      return;
    }

    registerWorshipProtocolHandler(getMediaRepo());
    registerAllIpcHandlers();
    // Before the first window: the default menu's Cmd+W (which closes the
    // PROJECTOR) and Cmd+R must never be reachable, not even for one frame.
    installApplicationMenu();

    // Non-blocking: creates the cache dirs, sweeps anything a crash left
    // half-converted, locates LibreOffice and warms its profile. A failure
    // here must never keep the app from starting. It yields an event-loop
    // turn before its first synchronous filesystem work — `void` alone only
    // defers from the first `await`, which used to be after the whole sweep.
    void initSlidesSubsystem().catch((error: unknown) => {
      console.warn("[slides] init failed", error);
    });
    startLibrarySweepScheduler();

    // The other half of the legacy import (`media_library.json`). Off the
    // startup path: it is a whole library's worth of files, and the rows it
    // creates reach an open window through `library-changed`.
    void migrateLegacyMediaIfPresent().catch((error: unknown) => {
      console.warn("[legacy] media migration failed", error);
    });

    // Teaches main which cached deck each presentation's BYTES belong to, so
    // "is this converted?" can be answered by content instead of by which
    // asset happens to own the deck row (`N3` in the media-chain audit §5.2).
    // Deferred like every other launch chore: it is a few seconds of
    // background reads and must never stand between the operator and a window.
    setTimeout(() => {
      void backfillContentHashes().catch((error: unknown) => {
        console.warn("[media] content-hash backfill failed", error);
      });
      // Recovers the auto-advance times LibreOffice's PPTX export dropped from
      // decks converted before that was understood — a re-read of the source
      // `.pps`, no reconversion. Same slot: both are one-time catch-up passes
      // over the library that must not stand between the operator and a
      // window. Independent of each other, so neither waits for the other.
      void backfillDeckTimings().catch((error: unknown) => {
        console.warn("[slides] timings backfill failed", error);
      });
    }, CONTENT_HASH_BACKFILL_DELAY_MS);

    // Collects thumbnails orphaned by an edited/replaced source file — their
    // cache key includes size+mtime, so nothing else ever removes them.
    // Deferred and best-effort: it is pure housekeeping and must never delay
    // the control window appearing.
    setTimeout(() => {
      void pruneThumbCache().catch((error: unknown) => {
        console.warn("[thumbs] prune failed", error);
      });
      // Same deal for the projection history: it grows by one row per change
      // of output and its `prune()` — which documents itself as "called once
      // at startup" — had no caller at all, so `MAX_ROWS` was never enforced.
      try {
        getHistoryRepo().prune();
      } catch (error) {
        console.warn("[history] prune failed", error);
      }
    }, THUMB_PRUNE_DELAY_MS);

    mainControlWindow = openControlWindow();

    app.on("activate", () => {
      // Counts only windows the user can actually see: the rasterizer is a
      // real (hidden) BrowserWindow, so `getAllWindows()` stays non-empty for
      // up to 60s after any conversion — during which a dock click used to
      // reopen nothing at all.
      if (userFacingWindows().length === 0) mainControlWindow = openControlWindow();
    });
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// Cancels in-flight jobs and kills soffice/the rasterizer. The deck cache is
// deliberately NOT deleted — persisting it is the point of the pipeline.
app.on("before-quit", () => {
  // Recorded BEFORE the windows get their `close`: the guard vetoes that
  // close, which cancels the whole quit, and this is what tells it to resume
  // the quit rather than merely close the window once the operator answers.
  markQuitRequested();
  shutdownSlides();
});

// `will-quit`, not `before-quit`, for two reasons. It runs after every window
// is gone, so no in-flight `projection:show` can reach `HistoryRepo.record()`
// on a connection that was just closed — and more importantly, `before-quit`
// now fires while the close guard may still be ASKING the operator, who is
// free to answer "cancel": closing the database there would leave a perfectly
// alive app with no database. Synchronous by necessity either way — see
// `.claude/knowledge/nothing-asynchronous-survives-before-quit.md`.
//
// Reaching it at all depends on the close guard resuming the quit with
// `app.quit()` rather than `win.close()`: vetoing a window's close during a
// quit cancels the quit outright, and `will-quit` never comes. See
// `windows/close-guard.ts`.
app.on("will-quit", () => {
  closeDatabase();
});

/** At most one crash dialog per run. `showErrorBox` is modal and blocking, so
 *  a repeating fault (a listener that throws on every event, say) turned the
 *  "health check" into a wall of dialogs the operator could not get past —
 *  during a service. Everything after the first still reaches `crash.log`. */
let crashDialogShown = false;

/** Past this, `crash.log` is rotated onto `crash.log.1`. A stack is ~1 KB, so
 *  this holds hundreds of them — and a repeating fault writes one per
 *  occurrence, forever, which is what used to grow the file without bound. */
const CRASH_LOG_MAX_BYTES = 1_000_000;

/** Rotation rather than truncation: the crash that matters is almost always
 *  the FIRST one, and a fault that repeats would otherwise erase exactly the
 *  entry worth reading. At most two files, so the ceiling stays ~2 MB. */
function rotateCrashLog(file: string): void {
  try {
    if (fs.statSync(file).size < CRASH_LOG_MAX_BYTES) return;
    fs.renameSync(file, `${file}.1`);
  } catch {
    // No file yet (the common case), or a rename we cannot do. Either way the
    // append below is still worth attempting.
  }
}

function reportCrash(label: string, error: unknown): void {
  const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
  try {
    const file = path.join(userDataDir, "crash.log");
    rotateCrashLog(file);
    fs.appendFileSync(file, `${new Date().toISOString()} [${label}] ${detail}\n`);
  } catch {
    // A crash handler that itself throws (a full disk) would take the process
    // down with no trace at all.
  }
  if (crashDialogShown) {
    console.error(`[${label}]`, error);
    return;
  }
  crashDialogShown = true;
  dialog.showErrorBox("Error inesperado", detail);
}

// Surface crashes as a dialog instead of a silent blank window — the health
// check the design doc calls for around the native SQLite module.
//
// Registering this handler also overrides Node's default of ABORTING the
// process, and that is the intended trade: a service with the app in a
// questionable state beats a service with no app at all, and the operator
// gets a dialog either way. The cost is real and is accepted here — after an
// uncaught throw, main's state may be inconsistent (a half-applied
// transaction, a queue entry that will never settle), so the honest advice to
// an operator who sees this dialog is to restart once the service is over.
process.on("uncaughtException", (error) => reportCrash("uncaughtException", error));

// Without this an unhandled rejection is a silent no-op (Electron does not
// abort on one), so the whole `void somethingAsync()` style used across main
// could fail invisibly.
process.on("unhandledRejection", (reason) => reportCrash("unhandledRejection", reason));
