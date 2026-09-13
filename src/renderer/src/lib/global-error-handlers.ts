import { toast } from "@renderer/lib/toast";

/** Consecutive failures collapse into one toast instead of stacking a wall of
 *  them over the workspace — a broken IPC channel fails on every retry. */
const REPEAT_WINDOW_MS = 5_000;

let lastMessage = "";
let lastShownAt = 0;

function surface(message: string): void {
  const now = Date.now();
  if (message === lastMessage && now - lastShownAt < REPEAT_WINDOW_MS) return;
  lastMessage = message;
  lastShownAt = now;
  toast.danger(message, { durationMs: 8000 });
}

function describe(reason: unknown): string {
  if (reason instanceof Error) return reason.message;
  if (typeof reason === "string") return reason;
  return String(reason);
}

/**
 * Makes an unhandled async failure visible.
 *
 * The renderer calls IPC as `void api.something()` in dozens of places — a
 * deliberate style (there is nothing useful to do with most of those results),
 * but it means a rejection had **nowhere to surface**: no `catch`, no
 * `unhandledrejection` listener, and React's error boundaries never see a
 * promise. A full disk, a locked database or a missing LibreOffice would
 * simply… not happen, silently, and the operator would be left wondering why
 * the click did nothing.
 *
 * Toast rather than a dialog on purpose: this fires for things that are often
 * recoverable, and a modal in the middle of a service is worse than the
 * failure it reports. Everything also goes to the console for a post-mortem.
 *
 * Returns the teardown, so a caller that mounts this can unmount it.
 */
export function installGlobalErrorHandlers(): () => void {
  const onRejection = (event: PromiseRejectionEvent) => {
    console.error("[renderer] unhandled rejection", event.reason);
    surface(describe(event.reason));
  };

  // `window.onerror`'s territory: a throw from an event handler or a timer
  // callback, which no error boundary can catch either.
  const onError = (event: ErrorEvent) => {
    console.error("[renderer] uncaught error", event.error ?? event.message);
    surface(describe(event.error ?? event.message));
  };

  window.addEventListener("unhandledrejection", onRejection);
  window.addEventListener("error", onError);
  return () => {
    window.removeEventListener("unhandledrejection", onRejection);
    window.removeEventListener("error", onError);
  };
}
