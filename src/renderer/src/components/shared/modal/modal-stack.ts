import { useSyncExternalStore } from "react";

let stack: string[] = [];
const listeners = new Set<() => void>();

/**
 * The rest of the app must not be reachable while a modal is up.
 *
 * Without this, Tab walked straight out of the dialog and on through the
 * TopBar, the three panels and the virtualized grid behind the backdrop — the
 * operator could end up pressing Enter on GO LIVE believing they were
 * confirming a dialog. `inert` is the platform's own answer and covers focus,
 * pointer events and the accessibility tree in one attribute.
 *
 * Applied to `#root` specifically: every modal, and the toast host, portal to
 * `document.body`, so both sit outside the inert subtree. Driven from push/pop
 * rather than from a component's render, so it is in place by the time the
 * newly mounted dialog runs its own focus effect — and back off before the
 * closing dialog restores focus to whatever opened it.
 */
function syncBackgroundInert(): void {
  const root = document.getElementById("root");
  if (!root) return;
  if (stack.length > 0) root.setAttribute("inert", "");
  else root.removeAttribute("inert");
}

export function pushModal(id: string): void {
  stack = [...stack, id];
  syncBackgroundInert();
  listeners.forEach((l) => l());
}

export function popModal(id: string): void {
  stack = stack.filter((x) => x !== id);
  syncBackgroundInert();
  listeners.forEach((l) => l());
}

/** The id of the modal on top, or `null` when none is open. Returned instead
 *  of a per-modal boolean so a modal can tell "nobody is on top yet" (the
 *  render before `pushModal`'s effect runs) from "somebody else is". */
export function getTopModalId(): string | null {
  return stack[stack.length - 1] ?? null;
}

export function subscribeModalStack(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Whether any modal is open — used to suspend global keyboard shortcuts, so
 *  a confirm dialog on top blocks Delete/Backspace the same as any other
 *  modal, without `App.tsx` having to track each modal's own open state. */
export function useAnyModalOpen(): boolean {
  return useSyncExternalStore(subscribeModalStack, () => stack.length > 0);
}
