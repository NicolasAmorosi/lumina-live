import { create } from "zustand";

export type ToastTone = "info" | "success" | "warning" | "danger";

export type ToastAction = { label: string; onClick: () => void };

export type ToastItem = {
  id: string;
  tone: ToastTone;
  message: string;
  action?: ToastAction | undefined;
  /** Dismissed, still on screen playing its exit animation. It stops being
   *  interactive the moment this flips — otherwise the 180 ms of fade are a
   *  window where "Undo" still looks clickable and no longer is. */
  exiting?: boolean;
  /** `null` means no auto-dismiss — always the case when there's an `action`,
   *  so an accountable toast can never evaporate before the operator reads it. */
  durationMs: number | null;
};

type ToastInput = {
  tone: ToastTone;
  message: string;
  action?: ToastAction | undefined;
  durationMs?: number | null | undefined;
};

type ToastStoreState = {
  toasts: ToastItem[];
  push: (input: ToastInput) => string;
  dismiss: (id: string) => void;
};

const DEFAULT_DURATION_MS = 4000;

/** Must match the `toast-exit` animation in `styles/globals.css`: the item is
 *  removed from the store when the animation ends, so a shorter value here
 *  cuts the fade off and a longer one leaves an invisible gap in the stack. */
const EXIT_MS = 180;

/** Most toasts on screen at once. Past this the oldest is retired to make
 *  room: a burst — one per failing file while a whole folder is missing —
 *  otherwise stacks past the height of the window, hiding the app behind its
 *  own notifications and burying the newest (most relevant) message off
 *  screen. A toast carrying an `action` is never auto-dismissed, so without a
 *  cap a burst of those would stay there for the rest of the service. */
const MAX_TOASTS = 4;

/** Auto-dismiss timers, so a toast closed by hand (or evicted by the cap)
 *  doesn't leave one behind still counting down towards an id that is already
 *  gone. */
const timers = new Map<string, ReturnType<typeof setTimeout>>();

/** Separate from `timers`: a toast being dismissed has already had its
 *  auto-dismiss timer cancelled, and these have to be cleared too when the cap
 *  evicts something that was already fading out. */
const exitTimers = new Map<string, ReturnType<typeof setTimeout>>();

function cancelTimer(id: string): void {
  const timer = timers.get(id);
  if (timer !== undefined) {
    clearTimeout(timer);
    timers.delete(id);
  }
  const exitTimer = exitTimers.get(id);
  if (exitTimer !== undefined) {
    clearTimeout(exitTimer);
    exitTimers.delete(id);
  }
}

export const useToastStore = create<ToastStoreState>((set, get) => ({
  toasts: [],

  push: ({ tone, message, action, durationMs }) => {
    const id = crypto.randomUUID();
    // `undefined` means "unspecified" and `null` means "never auto-dismiss",
    // so this cannot be `??`: that treats both as absent and gives an
    // explicit `durationMs: null` the 4 s default, which is the opposite of
    // what the field documents.
    const effectiveDuration =
      durationMs !== undefined ? durationMs : action ? null : DEFAULT_DURATION_MS;
    const evicted: string[] = [];
    set((state) => {
      const next = [...state.toasts, { id, tone, message, action, durationMs: effectiveDuration }];
      while (next.length > MAX_TOASTS) {
        const oldest = next.shift();
        if (oldest) evicted.push(oldest.id);
      }
      return { toasts: next };
    });
    for (const evictedId of evicted) cancelTimer(evictedId);
    if (effectiveDuration !== null) {
      timers.set(
        id,
        setTimeout(() => get().dismiss(id), effectiveDuration),
      );
    }
    return id;
  },

  /**
   * Starts the exit animation and removes the toast when it ends.
   *
   * Eviction by `MAX_TOASTS` is deliberately NOT animated: that path removes a
   * toast to make room for a new one, and fading it would keep its height in
   * the stack for exactly as long as the room is needed.
   */
  dismiss: (id) => {
    const item = get().toasts.find((t) => t.id === id);
    if (!item || item.exiting) return;
    cancelTimer(id);
    set((state) => ({
      toasts: state.toasts.map((t) => (t.id === id ? { ...t, exiting: true } : t)),
    }));
    exitTimers.set(
      id,
      setTimeout(() => {
        exitTimers.delete(id);
        set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
      }, EXIT_MS),
    );
  },
}));
