import { useToastStore, type ToastAction } from "@renderer/stores/toast.store";

/** Facade over the toast store for calling from `lib/actions/*` — plain
 *  functions outside React, not components — the same way `api` wraps `invoke`. */
type ToastOpts = { action?: ToastAction; durationMs?: number };

function push(tone: "info" | "success" | "warning" | "danger", message: string, opts?: ToastOpts) {
  return useToastStore.getState().push({ tone, message, action: opts?.action, durationMs: opts?.durationMs });
}

export const toast = {
  info: (message: string, opts?: ToastOpts) => push("info", message, opts),
  success: (message: string, opts?: ToastOpts) => push("success", message, opts),
  warning: (message: string, opts?: ToastOpts) => push("warning", message, opts),
  danger: (message: string, opts?: ToastOpts) => push("danger", message, opts),
};
