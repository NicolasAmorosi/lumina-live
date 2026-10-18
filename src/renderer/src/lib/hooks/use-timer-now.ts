import { useEffect, useState } from "react";
import { clampTickDelay, isTimerRunning, msUntilNextTick } from "@shared/timer";
import type { TimerClock, TimerFormat } from "@shared/types/timer";

/**
 * `Date.now()`, re-read exactly when the rendered value is about to change.
 *
 * Three deliberate choices, each of which is a bug avoided:
 *
 * 1. **A re-armed `setTimeout`, never `setInterval`.** The delay is measured
 *    to the next boundary of THIS clock (`msUntilNextTick`), not to the next
 *    wall-clock second — a countdown that ends at …:00.400 has to change its
 *    digit 400 ms past every second, and `setInterval` would also accumulate
 *    every scheduling delay it is ever handed.
 * 2. **The value is always derived from a fresh `Date.now()`, never
 *    decremented.** Chromium throttles a hidden page's timers to one per
 *    minute after five minutes, and an occluded Electron window has no
 *    rendering lifecycle at all (see
 *    `.claude/knowledge/occluded-electron-window-has-no-rendering-lifecycle.md`)
 *    — which is a real case here, since with a single monitor the projection
 *    window is an ordinary window the control window covers. A throttled tick
 *    shows a stale number while nobody is looking at it; it can never show a
 *    number that has drifted.
 * 3. **`visibilitychange` re-syncs immediately**, so the first frame after the
 *    window comes back is already correct rather than up to a second (or a
 *    throttled minute) late. This is why `backgroundThrottling` is left alone:
 *    turning it off carries a known blank-window bug (electron#42378) and this
 *    design does not need it.
 *
 * Nothing is scheduled at all for a held clock, or for a countdown resting at
 * 00:00 with overrun off — `msUntilNextTick` returns `null` when the text can
 * never change again.
 */
export function useTimerNow(clock: TimerClock, format: TimerFormat): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!isTimerRunning(clock)) return;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const arm = (from: number) => {
      const delay = msUntilNextTick(clock, from, format);
      if (delay === null) return;
      timer = setTimeout(() => {
        const current = Date.now();
        setNow(current);
        arm(current);
      }, clampTickDelay(delay));
    };

    const sync = () => {
      if (timer !== null) clearTimeout(timer);
      const current = Date.now();
      // React bails out when the value is unchanged, so the common case of
      // re-arming after an identical push costs nothing.
      setNow(current);
      arm(current);
    };

    // Synced on mount too, not just armed: between the render that produced
    // this clock and this effect, the second may already have turned over.
    sync();

    const onVisibility = () => {
      if (document.visibilityState === "visible") sync();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      if (timer !== null) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [clock, format]);

  return now;
}
