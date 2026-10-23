import { create } from "zustand";
import { initialClock, resumeClock } from "@shared/timer";
import type { UtilityScene } from "@shared/types/utility";
import type { BaseContent } from "@shared/types/projection";
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
 * says START or RESUME, and whether GO LIVE should start the count.
 */
export type TimerRun = {
  sceneId: number;
  clock: TimerClock;
  started: boolean;
};

type UtilityStoreState = {
  scenes: UtilityScene[];
  run: TimerRun | null;

  /** Replaces the mirror of `utility_scenes`. Drops the armed timer when its
   *  scene is no longer in the list: a transport counting down for a scene the
   *  operator just deleted has nothing left to project. */
  setScenes: (scenes: UtilityScene[]) => void;
  /** Arms the scene's timer from zero and starts it running. Returns the clock
   *  it committed, so a caller that has to project it in the same tick never
   *  has to re-read the store. */
  start: (scene: UtilityScene) => TimerClock;
  /** What GO LIVE uses: resumes the armed clock — wherever the operator left
   *  it — and leaves one they deliberately paused exactly as it is. */
  ensureStarted: (scene: UtilityScene) => TimerClock;
  /** Puts a clock the transport already computed into the armed slot, arming
   *  this scene if another one held it.
   *
   *  Pausing, resuming, resetting and seeking all go through here rather than
   *  through a method each, because none of them can decide on its own where
   *  the result belongs: the same gesture writes to the projector when the
   *  scene is live, to this slot when it is not, and to both when it is both.
   *  That decision is `lib/actions/utility.ts`'s, next to the pure transitions
   *  it applies (`holdClock`, `resumeClock`, `seekCountdown`, `initialClock`),
   *  and this store stays what it says it is: the one timer the operator
   *  armed. */
  arm: (sceneId: number, clock: TimerClock, started: boolean) => void;
};

export const useUtilityStore = create<UtilityStoreState>()((set, get) => ({
  // Empty until `loadScenes()` mirrors `utility:list` in, at boot. Main seeds
  // the four built-in scenes into a fresh database once
  // (`db/seed/seed-utility-scenes.ts`), so this is only ever briefly empty —
  // or permanently, for an operator who deleted them all, which the panel
  // shows as an empty state rather than papering over with constants.
  scenes: [],
  run: null,

  setScenes: (scenes) =>
    set((state) => {
      const { run } = state;
      const survives = run !== null && scenes.some((scene) => scene.id === run.sceneId);
      return survives ? { scenes } : { scenes, run: null };
    }),

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
    if (run?.sceneId === scene.id) {
      // Already going (or deliberately paused after being started): untouched.
      if (run.started) return run.clock;
      // Armed but never started — which is what dragging the PREVIEW row's bar
      // leaves behind (`seekTimer`). RESUMING that clock instead of building a
      // fresh one is what makes GO LIVE start the countdown from where the
      // operator dropped the marker, exactly like a video's preview scrub
      // deciding its `startAtSeconds`. Rebuilding it was a silent reset: the
      // armed value was on screen in two monitors and then the projector
      // showed the full duration.
      const now = Date.now();
      const clock = resumeClock(run.clock, now);
      set({ run: { sceneId: scene.id, clock, started: true } });
      return clock;
    }
    return get().start(scene);
  },

  arm: (sceneId, clock, started) => set({ run: { sceneId, clock, started } }),
}));

/**
 * The clock a given scene must be drawn with, anywhere in the control window:
 * the projector's own copy when this scene is what is live, the armed one when
 * it is armed, and its resting value otherwise.
 *
 * **Live wins, and that is the whole point of the function.** The same scene
 * can be on screen in two columns at once — the PREVIEW row and the LIVE row,
 * side by side, plus its row in the Utilities list — and two of them showing
 * two different numbers for one timer is the monitors lying to the operator.
 * The projector holds the truth (`base.clock`), so everything else reads it.
 *
 * The armed slot and the live copy are still genuinely two clocks, because two
 * different scenes can hold them: a countdown on the projector while the
 * operator prepares the next one. They can never be two clocks for the SAME
 * scene, which is what this collapses.
 *
 * `now` is a parameter rather than a `Date.now()` inside, so a caller that has
 * to memoize the result can hand it something that only changes when the
 * answer does — every caller passes today's midnight, which is the only part
 * of "now" a resting clock depends on (a countdown to 10:00 resolves against
 * today's date and nothing finer).
 *
 * Only the last branch builds a fresh object, which is safe: it reaches a React
 * render or a preview output, both of which compare by content and not identity
 * (see `sceneContentKey`). The clock that reaches `selectOutput` is never this
 * one — it is the committed copy inside `base`, precisely so the memo guarding
 * every push can compare it by reference.
 */
export function clockForScene(
  base: BaseContent | null,
  run: TimerRun | null,
  scene: UtilityScene,
  now: number,
): TimerClock {
  if (base?.kind === "utility" && base.sceneId === scene.id) return base.clock;
  if (run && run.sceneId === scene.id) return run.clock;
  return initialClock(scene.tool, scene.config, now);
}

export function findScene(scenes: readonly UtilityScene[], sceneId: number): UtilityScene | null {
  return scenes.find((scene) => scene.id === sceneId) ?? null;
}
