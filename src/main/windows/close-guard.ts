import { app, BrowserWindow, type Event, type WebContents } from "electron";
import { broadcast } from "../services/broadcast";
import type { CloseDecision } from "@shared/types/window";

/**
 * Closing the control window is the control window's decision, not main's.
 *
 * The schedule being edited lives in the renderer, and `CLAUDE.md` is explicit
 * that main does not get a second, inferred copy of what the control window
 * knows. So main never asks itself "is there unsaved work?" — it vetoes the
 * close once, tells the control window the operator wants out, and waits to be
 * told what to do. Only the renderer can put the question to the operator, in
 * the app's own language, next to a Save button that actually works.
 *
 * The grace timer is the other half of the contract: a renderer that is
 * wedged, crashed, or simply has no listener must never make the app
 * unquittable. By the time it fires, the draft autosave (`program:saveDraft`)
 * has already put the schedule on disk, so closing without an answer loses
 * nothing.
 */
const GRACE_MS = 4_000;

/**
 * A close that has been vetoed and is waiting on the renderer.
 *
 * `wasQuit` is the part that is easy to get wrong. Vetoing a window's `close`
 * during a quit does not merely delay it — it CANCELS the whole quit, and
 * `will-quit` never runs. So the answer "yes, close" has to resume the quit
 * with `app.quit()` rather than just `win.close()`, or the app lives on with
 * no window: on macOS that looks like a clean exit while the process is still
 * there, and every `will-quit` chore (closing the database, which is what
 * checkpoints the WAL) is silently skipped. The intent is captured HERE, on
 * the pending close, because the global flag gets cleared while the operator
 * is still reading the dialog.
 */
type PendingClose = { timer: NodeJS.Timeout | null; wasQuit: boolean };

/** Windows already cleared to close, so the `close` that `resolve` itself
 *  triggers passes straight through instead of asking a second time. */
const cleared = new WeakSet<WebContents>();
const pending = new WeakMap<WebContents, PendingClose>();

/** Set by `holdQuitUntilAnswered`, consumed by the next vetoed close. */
let quitRequested = false;

/** The control window, the only one whose close asks the operator. */
let guarded: BrowserWindow | null = null;

/**
 * Called from `before-quit`. It holds the WHOLE quit until the control window
 * answers, instead of letting Electron start closing windows and vetoing only
 * the control window's `close`.
 *
 * That veto came too late. By the time the control window got its `close`,
 * Electron had already closed the projection window, which has no guard. So an
 * operator who hit ⌘Q by accident and answered «Cancel» kept the app and lost
 * the projector, in front of the congregation (measured in the 2026-10-14
 * rehearsal). Preventing `before-quit` itself means no window closes and none of
 * the quit's shutdown chores run until the answer is "close", and that answer
 * resumes the quit with `app.quit()`.
 *
 * Returns true when the quit is being held. The caller must then skip its
 * shutdown work.
 */
export function holdQuitUntilAnswered(event: Event): boolean {
  const win = guarded;
  if (!win || win.isDestroyed() || cleared.has(win.webContents)) return false;
  event.preventDefault();
  quitRequested = true;
  win.close();
  return true;
}

/**
 * Lets the updater's own quit through without asking. The control window has
 * already put the question (`installUpdate` in the renderer), and the installer
 * just launched kills the app within seconds whatever the answer: a second
 * question would offer a «Cancel» that cancels nothing, with the projector on.
 */
export function releaseForUpdate(): void {
  if (guarded && !guarded.isDestroyed()) cleared.add(guarded.webContents);
}

export function installCloseGuard(win: BrowserWindow): void {
  guarded = win;
  win.on("close", (event) => {
    if (cleared.has(win.webContents)) return;
    event.preventDefault();
    // Already asked and still waiting: swallow the repeat rather than
    // restarting the grace period on every impatient Cmd+Q.
    if (pending.has(win.webContents)) return;

    pending.set(win.webContents, {
      wasQuit: quitRequested,
      timer: setTimeout(() => {
        const entry = pending.get(win.webContents);
        if (entry) entry.timer = null;
        if (!win.isDestroyed()) resolveClose(win, "close");
      }, GRACE_MS),
    });
    // Captured onto the pending close; the flag itself must not survive to
    // colour an unrelated close later on.
    quitRequested = false;
    broadcast("close-requested", undefined);
  });
}

/**
 * The control window's answer.
 *
 * - `"close"`: go ahead (the operator confirmed, or there was nothing to lose).
 * - `"hold"`: a dialog is on screen — drop the grace timer so the window is
 *   never closed out from under a question the operator is still reading, but
 *   keep the pending close so the answer still knows it came from a quit.
 * - `"cancel"`: the operator said no. Forget everything, so the next close
 *   asks again instead of finding a stale pending record and staying silent.
 */
export function resolveClose(win: BrowserWindow, decision: CloseDecision): void {
  const entry = pending.get(win.webContents);
  if (decision === "hold") {
    if (entry?.timer) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }
    return;
  }

  if (entry?.timer) clearTimeout(entry.timer);
  pending.delete(win.webContents);
  if (decision === "cancel") return;

  cleared.add(win.webContents);
  if (entry?.wasQuit) app.quit();
  else win.close();
}
