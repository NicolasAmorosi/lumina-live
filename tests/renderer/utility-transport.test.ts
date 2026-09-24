/**
 * The time-scene transport — the half of the feature that is not about what
 * the projector draws, but about WHERE the clock the operator just touched
 * gets written.
 *
 * A scene's clock lives in one of two places, sometimes both: the copy the
 * projector is drawing (`projection.store`'s `base`) and the one the operator
 * armed without projecting anything (`utility.store`'s `run`). The same
 * transport row is rendered in the PREVIEW column and in the LIVE column, so
 * every one of these gestures has to land in the right place — and the two
 * rows can be on screen at once for the same scene, which is why they can
 * never end up holding two different clocks for it.
 *
 * None of it may bump `sceneEpoch`: that is the F1 rule (`utilidades.md`), and
 * breaking it cross-fades the projector into a near-identical copy of itself
 * in the middle of a service.
 */
import { beforeEach, describe, expect, test } from "vitest";
import { useProjectionStore } from "@renderer/stores/projection.store";
import { clockForScene, useUtilityStore } from "@renderer/stores/utility.store";
import { resetTimer, seekTimer, toggleTimer } from "@renderer/lib/actions/utility";
import { isTimerRunning } from "@shared/timer";
import { DEFAULT_SCENE_STYLE } from "@shared/types/scene-style";
import { DEFAULT_TIMER_FORMAT } from "@shared/types/timer";
import type { TimerClock } from "@shared/types/timer";
import type { UtilityScene } from "@shared/types/utility";

const projectionInitialState = useProjectionStore.getState();
const utilityInitialState = useUtilityStore.getState();

const TEN_MINUTES = 600_000;

function scene(overrides: Partial<UtilityScene> = {}): UtilityScene {
  return {
    id: 1,
    name: "Cuenta 10 minutos",
    tool: "countdown",
    config: { durationMs: TEN_MINUTES, targetMinuteOfDay: 600, endMessage: null, format: DEFAULT_TIMER_FORMAT },
    style: DEFAULT_SCENE_STYLE,
    title: null,
    message: null,
    ...overrides,
  };
}

/** Puts the scene on the projector the way `goLiveWithUtilityScene` does. */
function goLive(target: UtilityScene, clock: TimerClock): void {
  useProjectionStore.getState().setBase({ kind: "utility", sceneId: target.id, scene: target, clock });
}

function liveClock(): TimerClock | null {
  const { base } = useProjectionStore.getState();
  return base?.kind === "utility" ? base.clock : null;
}

/** The projector's clock, narrowed — every scene in this file is a countdown,
 *  and a throw here says "the projector is not showing what this test set up"
 *  rather than letting an optional chain quietly assert `undefined`. */
function liveCountdown(): Extract<TimerClock, { mode: "countdown" }> {
  const clock = liveClock();
  if (clock?.mode !== "countdown") throw new Error("the projector is not showing a countdown");
  return clock;
}

beforeEach(() => {
  useProjectionStore.setState(projectionInitialState, true);
  useUtilityStore.setState(utilityInitialState, true);
});

describe("which clock a row is reading", () => {
  test("the projector's copy wins over the armed one for the same scene", () => {
    const target = scene();
    const armed: TimerClock = { mode: "countdown", state: "held", remainingMs: 1_000 };
    const projected: TimerClock = { mode: "countdown", state: "running", endsAtMs: 5_000 };
    useUtilityStore.getState().arm(target.id, armed, true);
    goLive(target, projected);

    // The PREVIEW row, the LIVE row and the list row all go through this. Two
    // numbers for one timer is the monitors lying to the operator.
    expect(clockForScene(useProjectionStore.getState().base, useUtilityStore.getState().run, target, 0)).toBe(
      projected,
    );
  });

  test("a scene nobody armed and nobody projected rests at its starting value", () => {
    const resting = clockForScene(null, null, scene(), 0);
    expect(resting).toEqual({ mode: "countdown", state: "held", remainingMs: TEN_MINUTES });
    expect(isTimerRunning(resting)).toBe(false);
  });

  test("another scene's armed timer is not this scene's clock", () => {
    const other = scene({ id: 2 });
    useUtilityStore.getState().arm(other.id, { mode: "stopwatch", state: "running", startedAtMs: 0 }, true);
    expect(clockForScene(null, useUtilityStore.getState().run, scene(), 0).mode).toBe("countdown");
  });
});

describe("where a gesture is written", () => {
  test("play on a scene that is only previewed arms it, and touches nothing live", () => {
    const target = scene();
    toggleTimer(target);

    const { run } = useUtilityStore.getState();
    expect(run?.sceneId).toBe(target.id);
    expect(run?.started).toBe(true);
    expect(run && isTimerRunning(run.clock)).toBe(true);
    expect(useProjectionStore.getState().base).toBeNull();
  });

  test("pause on what is live reaches the projector without beginning a scene", () => {
    const target = scene();
    goLive(target, { mode: "countdown", state: "running", endsAtMs: Date.now() + TEN_MINUTES });
    const epoch = useProjectionStore.getState().sceneEpoch;

    toggleTimer(target);

    expect(liveCountdown().state).toBe("held");
    // A bumped epoch here is a cross-fade into an almost identical copy of the
    // same scene, mid-service.
    expect(useProjectionStore.getState().sceneEpoch).toBe(epoch);
  });

  test("the live copy and the armed copy stay the same object for the same scene", () => {
    const target = scene();
    useUtilityStore.getState().arm(target.id, { mode: "countdown", state: "held", remainingMs: TEN_MINUTES }, true);
    goLive(target, { mode: "countdown", state: "running", endsAtMs: Date.now() + TEN_MINUTES });

    toggleTimer(target);

    expect(useUtilityStore.getState().run?.clock).toBe(liveClock());
  });

  test("pausing what is live does not steal the timer armed for another scene", () => {
    const live = scene();
    const prepared = scene({ id: 2, name: "Cronómetro", tool: "stopwatch" });
    const preparedClock: TimerClock = { mode: "stopwatch", state: "running", startedAtMs: 1_000 };
    useUtilityStore.getState().arm(prepared.id, preparedClock, true);
    goLive(live, { mode: "countdown", state: "running", endsAtMs: Date.now() + TEN_MINUTES });

    toggleTimer(live);

    // The operator prepared that stopwatch on purpose; pausing what is on the
    // screen is no reason to throw it away.
    expect(useUtilityStore.getState().run).toEqual({ sceneId: prepared.id, clock: preparedClock, started: true });
    expect(liveCountdown().state).toBe("held");
  });
});

describe("what each control does to the count", () => {
  test("pause and resume continue where they stopped, on the projector", () => {
    const target = scene();
    goLive(target, { mode: "countdown", state: "running", endsAtMs: Date.now() + 120_000 });

    toggleTimer(target);
    const held = liveCountdown();
    expect(held.state).toBe("held");
    expect(held.state === "held" && held.remainingMs).toBeGreaterThan(110_000);

    toggleTimer(target);
    expect(liveCountdown().state).toBe("running");
  });

  test("the list's STOP puts the count back at its starting value, stopped", () => {
    const target = scene();
    useUtilityStore.getState().arm(target.id, { mode: "countdown", state: "running", endsAtMs: 1 }, true);

    resetTimer(target);

    expect(useUtilityStore.getState().run).toEqual({
      sceneId: target.id,
      clock: { mode: "countdown", state: "held", remainingMs: TEN_MINUTES },
      started: false,
    });
  });

  test("a seek moves the count without starting it", () => {
    const target = scene();
    // Never started: the bar is how an operator aims a countdown before the
    // service, and dropping the thumb must not set it running.
    seekTimer(target, 90_000);

    const { run } = useUtilityStore.getState();
    expect(run?.clock).toEqual({ mode: "countdown", state: "held", remainingMs: 90_000 });
    expect(run?.started).toBe(false);
  });

  test("EN VIVO starts the count where the preview bar was left, not at the top", () => {
    // The whole point of aiming a countdown on the PREVIEW row: the operator
    // drags it to 1:30, presses EN VIVO, and the projector starts at 1:30. The
    // same promise a video's preview scrub makes through `startAtSeconds`.
    const target = scene();
    seekTimer(target, 90_000);

    const clock = useUtilityStore.getState().ensureStarted(target);

    expect(clock.mode === "countdown" && clock.state).toBe("running");
    expect(clock.mode === "countdown" && clock.state === "running" && clock.endsAtMs - Date.now()).toBeGreaterThan(
      85_000,
    );
    expect(clock.mode === "countdown" && clock.state === "running" && clock.endsAtMs - Date.now()).toBeLessThan(
      95_000,
    );
    // And the armed slot agrees, so the two rows keep showing one number.
    expect(useUtilityStore.getState().run).toEqual({ sceneId: target.id, clock, started: true });
  });

  test("EN VIVO leaves a count the operator paused on purpose exactly as it is", () => {
    const target = scene();
    useUtilityStore.getState().arm(target.id, { mode: "countdown", state: "held", remainingMs: 42_000 }, true);

    expect(useUtilityStore.getState().ensureStarted(target)).toEqual({
      mode: "countdown",
      state: "held",
      remainingMs: 42_000,
    });
  });

  test("seeking a running countdown keeps it running, and reaches the projector", () => {
    const target = scene();
    goLive(target, { mode: "countdown", state: "running", endsAtMs: Date.now() + TEN_MINUTES });
    const epoch = useProjectionStore.getState().sceneEpoch;

    seekTimer(target, 30_000);

    const clock = liveCountdown();
    expect(clock.state).toBe("running");
    expect(clock.state === "running" && clock.endsAtMs - Date.now()).toBeGreaterThan(25_000);
    expect(useProjectionStore.getState().sceneEpoch).toBe(epoch);
  });
});
