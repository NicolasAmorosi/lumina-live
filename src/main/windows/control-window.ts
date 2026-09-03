import { app, BrowserWindow, screen } from "electron";
import path from "node:path";

const PRELOAD = path.join(__dirname, "../preload/index.js");

export function createControlWindow(): BrowserWindow {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const win = new BrowserWindow({
    width: Math.min(1400, width),
    height: Math.min(900, height),
    minWidth: 1000,
    minHeight: 700,
    backgroundColor: "#0b1929",
    show: false,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  // electron-vite sets ELECTRON_RENDERER_URL in `electron-vite dev`; app.isPackaged
  // is the production check. Both paths avoid the church-presenter bug of NODE_ENV
  // never being set and dev always falling through to loadFile.
  const devServerUrl = process.env["ELECTRON_RENDERER_URL"];
  if (!app.isPackaged && devServerUrl) {
    win.loadURL(devServerUrl);
  } else {
    win.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

  win.once("ready-to-show", () => win.show());

  return win;
}
