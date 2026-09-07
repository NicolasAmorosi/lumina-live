import { BrowserWindow } from "electron";
import type { IpcEventName, IpcEvents } from "@shared/ipc/contract";

/**
 * Push an event to every live window. Until now main had no way to do this,
 * which is the concrete reason `library-changed` was declared in the contract
 * and never emitted from anywhere.
 *
 * Targeted sends (the projection window specifically) still go through
 * `projectionState` / `webContents.send` directly — this is for events any
 * window may care about.
 */
export function broadcast<K extends IpcEventName>(channel: K, payload: IpcEvents[K]): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    win.webContents.send(channel, payload);
  }
}
