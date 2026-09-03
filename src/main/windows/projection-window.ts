import { app, BrowserWindow, screen } from "electron";
import path from "node:path";

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
    show: false,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  const devServerUrl = process.env["ELECTRON_RENDERER_URL"];
  if (!app.isPackaged && devServerUrl) {
    win.loadURL(`${devServerUrl}/projection.html`);
  } else {
    win.loadFile(path.join(__dirname, "../renderer/projection.html"));
  }

  win.once("ready-to-show", () => win.show());
  if (!singleMonitor) {
    win.setAlwaysOnTop(true, "screen-saver");
  }

  return win;
}
