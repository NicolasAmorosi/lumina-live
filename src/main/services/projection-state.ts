import type { BrowserWindow } from "electron";
import type { DeckSoundtrackPush, ProjectionOutput } from "@shared/types/projection";

/**
 * Holds the last output sent to the projection window and a reference to that
 * window. `getSnapshot()` is what the projection window pulls once on mount:
 * a fresh `projection:open` shows the window before its page has loaded, and
 * `send()`/`setSoundtrack()` calls made in that gap (goLive() runs right
 * after `openIfNeeded()`, with no wait for the page to be ready) would
 * otherwise race the renderer's own `display-content`/`deck-soundtrack`
 * listener — pushed while nothing is listening yet is a silent drop, not a
 * queued delivery. Pulling the last known state once mounted needs no timing
 * assumption about `did-finish-load` vs. React mounting.
 */
class ProjectionState {
  private window: BrowserWindow | null = null;
  private lastOutput: ProjectionOutput | null = null;
  private lastSoundtrack: DeckSoundtrackPush = null;

  setWindow(win: BrowserWindow | null): void {
    this.window = win;
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
    this.getWindow()?.webContents.send("deck-soundtrack", soundtrack);
  }

  getSnapshot(): { output: ProjectionOutput | null; soundtrack: DeckSoundtrackPush } {
    return { output: this.lastOutput, soundtrack: this.lastSoundtrack };
  }
}

export const projectionState = new ProjectionState();
