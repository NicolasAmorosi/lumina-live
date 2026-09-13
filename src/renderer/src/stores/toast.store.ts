import { create } from "zustand";

export type ToastTone = "info" | "success" | "warning" | "danger";

export type ToastAction = { label: string; onClick: () => void };

export type ToastItem = {
  id: string;
  tone: ToastTone;
  message: string;
  action?: ToastAction | undefined;
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

function cancelTimer(id: string): void {
  const timer = timers.get(id);
  if (timer === undefined) return;
  clearTimeout(timer);
  timers.delete(id);
}

export const useToastStore = create<ToastStoreState>((set, get) => ({
  toasts: [],

  push: ({ tone, message, action, durationMs }) => {
    const id = crypto.randomUUID();
    const effectiveDuration = durationMs ?? (action ? null : DEFAULT_DURATION_MS);
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

  dismiss: (id) => {
    cancelTimer(id);
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
  },
}));
