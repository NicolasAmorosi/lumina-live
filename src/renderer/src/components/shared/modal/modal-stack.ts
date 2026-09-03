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
