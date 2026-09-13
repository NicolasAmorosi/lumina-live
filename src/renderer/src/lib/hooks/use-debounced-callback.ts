import { useEffect, useRef } from "react";

/** Trailing-only debounce for a callback whose identity may change every
 *  render (it always calls the LATEST version passed in, via a ref, so the
 *  caller never has to wrap it in `useCallback` first). Pending calls are
 *  dropped on unmount. */
export function useDebouncedCallback<Args extends unknown[]>(
  callback: (...args: Args) => void,
  delayMs: number,
): (...args: Args) => void {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  return (...args: Args) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => callbackRef.current(...args), delayMs);
  };
}
