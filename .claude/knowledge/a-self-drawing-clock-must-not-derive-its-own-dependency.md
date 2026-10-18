## A component that draws a clock must not derive that clock in its own render, and must not tick on the wall-clock second
**Area:** renderer
**Trigger:** building or touching anything that redraws itself on a timer — the utility scenes (`TimerScene`, `TimerTransport`), the Overlays auto-hide that `overlays.md` phase 3 plans, or any future "N seconds left" readout.

The pattern that works is in `src/renderer/src/lib/hooks/use-timer-now.ts` +
`src/shared/timer.ts::msUntilNextTick`. Two separate traps got it there.

### 1. Deriving the clock in the render of the component that ticks is a hot loop

- **Believed:** `const clock = clockForScene(run, scene)` in the body of a component that also
  calls `useTimerNow(clock, format)` is fine, because the value it computes is the same every
  time.

  **False.** The *value* is the same; the *object* is not. `useTimerNow` sets state on every
  tick → the component re-renders → `clockForScene` builds a new object → the effect's
  dependency changed → the effect re-arms and calls `setNow(Date.now())` → a different
  millisecond → re-render. Not once a second: as fast as React will schedule.

- It only bites where one component does BOTH. `usePreviewOutput` builds a fresh timer output on
  every render too and is perfectly safe, because the ticking lives in `TimerScene`, a child —
  a child's `setState` never re-renders its parent, so the prop identity holds still.

- **The fix is not `useMemo(..., [])`.** An un-armed "countdown to 10:00" resolves against
  *today*, so a memo pinned at mount is wrong for an app left open overnight. Memoize against a
  key that changes exactly when the answer does — `new Date().setHours(0,0,0,0)`, today's
  midnight, which is a primitive, stable through every tick, and different tomorrow. Doing that
  also forced `clockForScene(run, scene, now)` to take `now` as a parameter instead of reading
  `Date.now()` inside, which is what makes it testable at all.

- `eslint react-hooks/exhaustive-deps` is a useful oracle here: the first version passed the key
  as a dep without using it and was reported as "unnecessary dependency". Suppressing that
  warning would have been the wrong move — the honest fix (pass it *into* the call) is also the
  one that makes the function pure.

### 2. The tick is scheduled to the next boundary of ITS OWN value, not the next wall-clock second

- **Believed:** a clock re-renders once a second, so align to the second:
  `setTimeout(tick, 1000 - (Date.now() % 1000))`.

  **Wrong for anything counting to a mark.** A countdown that ends at `10:00:00.400` changes its
  digit 400 ms past every second. Aligned to the wall clock it would tick up to 999 ms away from
  the moment the number actually changes — visible next to a stopwatch, and wrong at exactly the
  second anybody is watching. `msUntilNextTick` returns `remaining % 1000` for a countdown,
  `1000 - (elapsed % 1000)` for a stopwatch (they round in opposite directions — see below), and
  for the wall clock derives the delay from `getMilliseconds()`/`getSeconds()` rather than
  `now % 60000`, which would be 30 minutes out of phase in a `:30` timezone.

- It also returns **`null`** for "the text can never change again" — a held clock, or a countdown
  resting at 00:00 with overrun off — so nothing is scheduled at all rather than a per-second
  wake-up that recomputes an identical string forever.

- Rounding is asymmetric and both halves are load-bearing: a countdown uses `Math.ceil` so a
  10-second timer reads `00:10` on its first frame (flooring shows `00:09` one millisecond in)
  and hits `00:00` exactly at zero; a stopwatch uses `Math.floor` so it stays at `00:00` for its
  whole first second.

### Why none of this is solved by `backgroundThrottling: false`

Chromium throttles a hidden page's timers to one per minute after five minutes, and an occluded
Electron window has no rendering lifecycle at all
([occluded-electron-window-has-no-rendering-lifecycle.md](occluded-electron-window-has-no-rendering-lifecycle.md))
— a real case here, since with one monitor the projection window is an ordinary window the
control window covers. The answer is that **the value is always recomputed from a fresh
`Date.now()`, never decremented**, plus a `visibilitychange` re-sync: a throttled tick can only
ever show a stale number while nobody is looking, and the first frame back is already correct.
Turning `backgroundThrottling` off instead carries a known blank-window bug (electron#42378) and
buys nothing this design needs.

**Last updated:** 2026-09-18
