import type { BrowserWindow } from "electron";
import type { DeckSoundtrackPush, ProjectionOutput } from "@shared/types/projection";

/**
 * Holds the last output sent to the projection window and a reference to that
 * window. Because the window is destroyed and recreated on every
 * `projection:open` (matching the legacy behavior), main must replay the last
 * output once the new window's `did-finish-load` fires, or reopening the
 * projection leaves it blank while the control window believes it's live.
 *
 * The deck soundtrack is snapshotted alongside it for the same reason: it is a
 * SECOND declarative input to the projection window (it has to outlive slide
 * changes and NEGRO/LOGO), so replaying only `lastOutput` would bring a deck
 * back silently. The control window re-seeks it once it sees the new epoch.
 */
class ProjectionState {
  private window: BrowserWindow | null = null;
  private lastOutput: ProjectionOutput | null = null;
  private lastSoundtrack: DeckSoundtrackPush = null;

  setWindow(win: BrowserWindow | null): void {
    this.window = win;
    if (win) {
      win.webContents.once("did-finish-load", () => {
        if (this.lastOutput) this.send(this.lastOutput);
        if (this.lastSoundtrack) this.sendSoundtrack(this.lastSoundtrack);
      });
    }
  }

  getWindow(): BrowserWindow | null {
    return this.window && !this.window.isDestroyed() ? this.window : null;
  }

  send(output: ProjectionOutput): void {
    this.lastOutput = output;
    this.getWindow()?.webContents.send("display-content", output);
  }

  setSoundtrack(soundtrack: DeckSoundtrackPush): void {
    this.lastSoundtrack = soundtrack;
    this.sendSoundtrack(soundtrack);
  }

  private sendSoundtrack(soundtrack: DeckSoundtrackPush): void {
    this.getWindow()?.webContents.send("deck-soundtrack", soundtrack);
  }

  getLastOutput(): ProjectionOutput | null {
    return this.lastOutput;
  }
}

export const projectionState = new ProjectionState();
