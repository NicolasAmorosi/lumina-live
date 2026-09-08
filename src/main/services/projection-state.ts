import type { BrowserWindow } from "electron";
import type { AudioTrackPush, ProjectionOutput } from "@shared/types/projection";

/**
 * Holds the last output sent to the projection window and a reference to that
 * window. `getSnapshot()` is what the projection window pulls once on mount:
 * a fresh `projection:open` shows the window before its page has loaded, and
 * `send()`/`setAudioTracks()` calls made in that gap (goLive() runs right
 * after `openIfNeeded()`, with no wait for the page to be ready) would
 * otherwise race the renderer's own `display-content`/`audio-tracks`
 * listener — pushed while nothing is listening yet is a silent drop, not a
 * queued delivery. Pulling the last known state once mounted needs no timing
 * assumption about `did-finish-load` vs. React mounting.
 */
class ProjectionState {
  private window: BrowserWindow | null = null;
  private lastOutput: ProjectionOutput | null = null;
  private lastAudioTracks: AudioTrackPush[] = [];

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

  setAudioTracks(tracks: AudioTrackPush[]): void {
    this.lastAudioTracks = tracks;
    this.getWindow()?.webContents.send("audio-tracks", tracks);
  }

  getSnapshot(): { output: ProjectionOutput | null; audioTracks: AudioTrackPush[] } {
    return { output: this.lastOutput, audioTracks: this.lastAudioTracks };
  }
}

export const projectionState = new ProjectionState();
