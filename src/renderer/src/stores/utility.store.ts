import { create } from "zustand";
import { holdClock, initialClock, resumeClock } from "@shared/timer";
import { DEFAULT_UTILITY_SCENES, type UtilityScene } from "@shared/types/utility";
import type { TimerClock } from "@shared/types/timer";

/**
 * The one timer the operator has armed.
 *
 * One at a time, by decision (2026-09-17): arming another scene's timer
 * replaces this slot. A scene that is already on the projector keeps counting
 * regardless — its mark lives in `projection.store`'s `base`, and a mark is
 * absolute — so abandoning the control of it never freezes what the
 * congregation is watching.
 *
 * `started` is the bit `TimerClock` deliberately does not carry. The projector
 * draws "paused" and "not started yet" identically and has no use for the
 * difference; the control window does, because it decides whether the button
 * says ARRANCAR or REANUDAR, and whether EN VIVO should start the count.
 */
export type TimerRun = {
  sceneId: number;
  clock: TimerClock;
  started: boolean;
};

type UtilityStoreState = {
  scenes: UtilityScene[];
  run: TimerRun | null;

  setScenes: (scenes: UtilityScene[]) => void;
  /** Arms the scene's timer from zero and starts it running. Returns the clock
   *  it committed, so a caller that has to project it in the same tick never
   *  has to re-read the store. */
  start: (scene: UtilityScene) => TimerClock;
  /** What EN VIVO uses: starts a timer that was never started, and leaves one
   *  the operator deliberately paused exactly as it is. */
  ensureStarted: (scene: UtilityScene) => TimerClock;
  /** Freezes the running timer at its current value. */
  hold: () => TimerClock | null;
  resume: () => TimerClock | null;
  /** Back to the scene's starting value, not running. */
  reset: (scene: UtilityScene) => TimerClock;
};

export const useUtilityStore = create<UtilityStoreState>()((set, get) => ({
  // F1 has no persistence: the built-in scenes ARE the list. From F2 on this
  // is filled from `utility:list` — same shape, so nothing here changes.
  scenes: [...DEFAULT_UTILITY_SCENES],
  run: null,

  setScenes: (scenes) => set({ scenes }),

  start: (scene) => {
    // One `now` for both halves: reading the clock twice would put the mark a
    // fraction of a millisecond off the value it was derived from.
    const now = Date.now();
    const clock = resumeClock(initialClock(scene.tool, scene.config, now), now);
    set({ run: { sceneId: scene.id, clock, started: true } });
    return clock;
  },

  ensureStarted: (scene) => {
    const { run } = get();
    if (run?.sceneId === scene.id && run.started) return run.clock;
    return get().start(scene);
  },

  hold: () => {
    const { run } = get();
    if (!run) return null;
    const clock = holdClock(run.clock, Date.now());
    set({ run: { ...run, clock } });
    return clock;
  },

  resume: () => {
    const { run } = get();
    if (!run) return null;
    const clock = resumeClock(run.clock, Date.now());
    set({ run: { ...run, clock, started: true } });
    return clock;
  },

  reset: (scene) => {
    const clock = initialClock(scene.tool, scene.config, Date.now());
    set({ run: { sceneId: scene.id, clock, started: false } });
    return clock;
  },
}));

/**
 * The clock a given scene should be drawn with: the armed one when it is this
 * scene's, otherwise the value it rests at.
 *
 * `now` is a parameter rather than a `Date.now()` inside, so a caller that has
 * to memoize the result can hand it something that only changes when the
 * answer does — the transport passes today's midnight, which is the only part
 * of "now" a resting clock depends on (a countdown to 10:00 resolves against
 * today's date and nothing finer).
 *
 * The fallback builds a fresh object every call, which is safe: it only ever
 * reaches a React render or a preview output, both of which compare by content
 * and not identity (see `sceneContentKey`). The clock that reaches
 * `selectOutput` is never this one — it is the committed copy inside `base`,
 * precisely so the memo guarding every push can compare it by reference.
 */
export function clockForScene(run: TimerRun | null, scene: UtilityScene, now: number): TimerClock {
  return run && run.sceneId === scene.id ? run.clock : initialClock(scene.tool, scene.config, now);
}

export function findScene(scenes: readonly UtilityScene[], sceneId: number): UtilityScene | null {
  return scenes.find((scene) => scene.id === sceneId) ?? null;
}
