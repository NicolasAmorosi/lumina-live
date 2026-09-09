import { useSyncExternalStore } from "react";

let stack: string[] = [];
const listeners = new Set<() => void>();

export function pushModal(id: string): void {
  stack = [...stack, id];
  listeners.forEach((l) => l());
}

export function popModal(id: string): void {
  stack = stack.filter((x) => x !== id);
  listeners.forEach((l) => l());
}

export function isTopModal(id: string): boolean {
  return stack[stack.length - 1] === id;
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
