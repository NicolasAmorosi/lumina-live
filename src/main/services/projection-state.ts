import type { BrowserWindow } from "electron";
import type { ProjectionOutput } from "@shared/types/projection";

/**
 * Holds the last output sent to the projection window and a reference to that
 * window. Because the window is destroyed and recreated on every
 * `projection:open` (matching the legacy behavior), main must replay the last
 * output once the new window's `did-finish-load` fires, or reopening the
 * projection leaves it blank while the control window believes it's live.
 */
class ProjectionState {
  private window: BrowserWindow | null = null;
  private lastOutput: ProjectionOutput | null = null;

  setWindow(win: BrowserWindow | null): void {
    this.window = win;
    if (win) {
      win.webContents.once("did-finish-load", () => {
        if (this.lastOutput) this.send(this.lastOutput);
      });
    }
  }

  getWindow(): BrowserWindow | null {
    return this.window && !this.window.isDestroyed() ? this.window : null;
  }

  send(output: ProjectionOutput): void {
    this.lastOutput = output;
    const win = this.getWindow();
    if (win) win.webContents.send("display-content", output);
  }

  getLastOutput(): ProjectionOutput | null {
    return this.lastOutput;
  }
}

export const projectionState = new ProjectionState();
