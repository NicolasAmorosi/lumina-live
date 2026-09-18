import { useProjectionStore } from "@renderer/stores/projection.store";
import { useUtilityStore } from "@renderer/stores/utility.store";
import type { TimerClock } from "@shared/types/timer";
import type { UtilityScene } from "@shared/types/utility";

/**
 * The transport: start, pause, resume and reset the one armed timer.
 *
 * These live in the actions layer because every one of them spans two stores.
 * `utility.store` owns the timer the operator is working with; `projection.
 * store` owns the copy that is on the projector, and the two are deliberately
 * NOT the same object — a scene can be live while the operator arms a
 * different one, and a timer can run for ten minutes before anybody projects
 * it.
 *
 * None of these begins a new scene. Pausing a countdown changes one field of
 * what is already on screen; treating it as a new scene would cross-fade the
 * projector into an almost identical copy of itself, mid-service.
 */

/** Mirrors a clock change onto the projector, but only while THIS scene is
 *  what is live. Anything else is a timer the congregation is not watching. */
function syncLiveClock(sceneId: number, clock: TimerClock | null): void {
  if (clock === null) return;
  const { base, setTimerClock } = useProjectionStore.getState();
  if (base?.kind !== "utility" || base.sceneId !== sceneId) return;
  setTimerClock(clock);
}

/** Starts the scene's timer from its configured value, whatever state it was
 *  in. Shared by the transport's play button and by EN VIVO. */
export function startTimer(scene: UtilityScene): void {
  syncLiveClock(scene.id, useUtilityStore.getState().start(scene));
}

export function resetTimer(scene: UtilityScene): void {
  syncLiveClock(scene.id, useUtilityStore.getState().reset(scene));
}

/**
 * The single play/pause control, so one button can never disagree with the
 * state it is describing: running → freeze it; paused → continue from where it
 * stopped; never started (or a different scene's timer is armed) → start it.
 */
export function toggleTimer(scene: UtilityScene): void {
  const store = useUtilityStore.getState();
  const { run } = store;
  if (!run || run.sceneId !== scene.id || !run.started) {
    startTimer(scene);
    return;
  }
  const clock = run.clock.mode !== "clock" && run.clock.state === "running" ? store.hold() : store.resume();
  syncLiveClock(scene.id, clock);
}
