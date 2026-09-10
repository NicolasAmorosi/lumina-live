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

export const useToastStore = create<ToastStoreState>((set, get) => ({
  toasts: [],

  push: ({ tone, message, action, durationMs }) => {
    const id = crypto.randomUUID();
    const effectiveDuration = durationMs ?? (action ? null : DEFAULT_DURATION_MS);
    set((state) => ({
      toasts: [...state.toasts, { id, tone, message, action, durationMs: effectiveDuration }],
    }));
    if (effectiveDuration !== null) {
      setTimeout(() => get().dismiss(id), effectiveDuration);
    }
    return id;
  },

  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));
