import { api } from "@renderer/lib/api";
import { t } from "@renderer/lib/i18n/i18n-provider";
import { toast } from "@renderer/lib/toast";
import { useProjectionStore } from "@renderer/stores/projection.store";
import { findScene, useUtilityStore } from "@renderer/stores/utility.store";
import type { TimerClock } from "@shared/types/timer";
import type { UtilityScene, UtilitySceneUpsert } from "@shared/types/utility";

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

/* -------------------------------------------------------------------------
 * The saved scenes
 *
 * `utility.store.scenes` is a MIRROR of `utility_scenes`, never a second copy
 * that drifts: every write below re-reads the list main answered with instead
 * of patching the array in place. The list is a handful of rows and main is
 * its only writer, so there is nothing to win by being clever and a stale row
 * to lose.
 * ---------------------------------------------------------------------- */

/** Reads the list into the store. Called once at boot, and after every write.
 *  Never throws: a control window that cannot list its scenes still has to
 *  start, the same rule the draft restore follows. */
export async function loadScenes(): Promise<void> {
  try {
    useUtilityStore.getState().setScenes(await api.utility.list());
  } catch (error) {
    console.warn("[utility] could not load the saved scenes", error);
    toast.danger(t("utilities.loadError"));
  }
}

/**
 * Creates or updates a scene, and re-dresses the projector when the scene
 * edited is the one that is live.
 *
 * Two things happen after the write, in this order, and both matter:
 *
 * 1. `setLiveScene` patches `base.scene` in place — the F2 gate. No
 *    `beginScene()`, so no transition; the mark inside `base.clock` is
 *    untouched, so the count does not restart.
 * 2. If the TOOL changed, the armed timer is re-armed from the new tool's
 *    starting value: an `endsAtMs` means nothing to a stopwatch, and a clock
 *    of the wrong mode would draw a number nobody can explain. This is the one
 *    edit that deliberately resets a running count, which is why the editor
 *    says so.
 */
export async function saveScene(input: UtilitySceneUpsert): Promise<UtilityScene | null> {
  const previous = input.id === undefined ? null : findScene(useUtilityStore.getState().scenes, input.id);
  try {
    const scene =
      input.id === undefined
        ? await api.utility.create(input)
        : await api.utility.update({ ...input, id: input.id });
    await loadScenes();

    useProjectionStore.getState().setLiveScene(scene);
    if (previous !== null && previous.tool !== scene.tool) {
      const { run } = useUtilityStore.getState();
      if (run?.sceneId === scene.id) resetTimer(scene);
    }
    return scene;
  } catch (error) {
    console.warn("[utility] could not save the scene", error);
    toast.danger(t("utilities.saveError"));
    return null;
  }
}

export async function duplicateScene(id: number, name: string): Promise<UtilityScene | null> {
  try {
    const scene = await api.utility.duplicate(id, name);
    await loadScenes();
    return scene;
  } catch (error) {
    console.warn("[utility] could not duplicate the scene", error);
    toast.danger(t("utilities.saveError"));
    return null;
  }
}

/**
 * Deletes a scene.
 *
 * What is on the projector is deliberately left alone. `base` holds a RESOLVED
 * copy of the scene (see `BaseContent`'s `utility` variant), so a countdown
 * that is live keeps counting on the screen the congregation is watching —
 * pulling it out from under them because the operator tidied a list would be
 * the app making a decision about the service. The armed timer does go, in
 * `setScenes`: a transport for a scene that no longer exists can neither be
 * restarted nor projected.
 */
export async function deleteScene(id: number): Promise<boolean> {
  try {
    await api.utility.remove(id);
    await loadScenes();
    return true;
  } catch (error) {
    console.warn("[utility] could not delete the scene", error);
    toast.danger(t("utilities.deleteError"));
    return false;
  }
}

/** Applies the operator's manual order. Replaces the list with what was
 *  actually persisted rather than the optimistic guess, like `reorderPrograms`. */
export async function reorderScenes(ids: number[]): Promise<void> {
  try {
    useUtilityStore.getState().setScenes(await api.utility.reorder(ids));
  } catch (error) {
    console.warn("[utility] could not reorder the scenes", error);
    toast.danger(t("utilities.reorderError"));
    await loadScenes();
  }
}
