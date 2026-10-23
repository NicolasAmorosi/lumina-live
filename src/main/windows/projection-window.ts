import { app, BrowserWindow, screen } from "electron";
import path from "node:path";
import { mt } from "../i18n";
import { trustWindow } from "../ipc/trusted-senders";
import { attachProjector } from "./projector-screen";

const PRELOAD = path.join(__dirname, "../preload/index.js");

/**
 * Recreated (not reused) on every `projection:open`, exactly like the legacy
 * `createPresentationWindow` — so main must replay `lastOutput` once the new
 * window finishes loading (see ipc/handlers/projection.ts), or a reopened
 * projection sits blank even though the control window thinks it's live.
 */
export function createProjectionWindow(displayId?: number): BrowserWindow {
  const displays = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();
  const target =
    (displayId !== undefined && displays.find((d) => d.id === displayId)) ||
    displays.find((d) => d.id !== primary.id) ||
    primary;

  const singleMonitor = displays.length === 1;

  const win = new BrowserWindow({
    x: target.bounds.x,
    y: target.bounds.y,
    width: singleMonitor ? 800 : target.bounds.width,
    height: singleMonitor ? 600 : target.bounds.height,
    center: singleMonitor,
    frame: false,
    fullscreen: !singleMonitor,
    alwaysOnTop: !singleMonitor,
    skipTaskbar: !singleMonitor,
    backgroundColor: "#000000",
    title: mt("window.projectionTitle"),
    show: false,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  trustWindow(win);
  attachProjector(win, target.id);
  // The page's <title> would replace the localized one on every load.
  win.on("page-title-updated", (event) => event.preventDefault());

  const devServerUrl = process.env["ELECTRON_RENDERER_URL"];
  // See `control-window.ts` for why these are `void` and not `.catch`.
  if (!app.isPackaged && devServerUrl) {
    void win.loadURL(`${devServerUrl}/projection.html`);
  } else {
    void win.loadFile(path.join(__dirname, "../renderer/projection.html"));
  }

  // Never focused on Windows: the operator's next →, B or Enter belongs to the
  // control window, and a focused projector also answered the window's own
  // shortcuts there. macOS keeps `show()`: a native fullscreen window on a
  // second display was verified with it (2026-10-14 rehearsal), and
  // `showInactive` there has not been.
  win.once("ready-to-show", () => (process.platform === "win32" ? win.showInactive() : win.show()));
  if (!singleMonitor) {
    win.setAlwaysOnTop(true, "screen-saver");
  }

  return win;
}
