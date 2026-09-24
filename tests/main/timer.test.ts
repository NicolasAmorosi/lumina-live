/**
 * `shared/timer.ts` — every time calculation in the app.
 *
 * All of it is pure `(clock, now)`, which is the point: the projection window,
 * the confidence monitors and the control window's transport all call these
 * same functions, so a disagreement between what the congregation sees and
 * what the operator sees could only come from a bug in here.
 *
 * The cases that earned their place: the rounding asymmetry (a countdown that
 * would otherwise show 00:09 the instant you start a 10-second timer), the
 * pause/resume round trip (which has to continue 30 seconds LATER, not
 * earlier), and `msUntilNextTick`, which is what makes the digit change at the
 * right instant instead of up to 999 ms off it.
 */
import { describe, expect, test } from "vitest";
import {
  clampTickDelay,
  countdownElapsedSeconds,
  editorRestingClock,
  EDITOR_SAMPLE_REMAINING_MS,
  formatDuration,
  formatMinuteOfDay,
  formatSignedSeconds,
  formatTimerClock,
  formatWallClock,
  hasReachedZero,
  holdClock,
  initialClock,
  isTimerRunning,
  msUntilNextTick,
  parseDuration,
  parseMinuteOfDay,
  pickValueColor,
  resolveTargetMs,
  resumeClock,
  seekCountdown,
  timerDisplaySeconds,
} from "../../src/shared/timer";
import { DEFAULT_TIMER_FORMAT, type TimerClock, type TimerConfig } from "../../src/shared/types/timer";

const NOW = new Date(2026, 8, 17, 9, 50, 0, 0).getTime();
const MINUTE = 60_000;

const overrun = { ...DEFAULT_TIMER_FORMAT, overrun: true };
const noOverrun = DEFAULT_TIMER_FORMAT;

function config(overrides: Partial<TimerConfig> = {}): TimerConfig {
  return {
    durationMs: 10 * MINUTE,
    targetMinuteOfDay: 10 * 60,
    endMessage: null,
    format: DEFAULT_TIMER_FORMAT,
    ...overrides,
  };
}

describe("a tool becomes one of three clocks", () => {
  test("a duration countdown rests at its full duration, not running", () => {
    expect(initialClock("countdown", config(), NOW)).toEqual({
      mode: "countdown",
      state: "held",
      remainingMs: 10 * MINUTE,
    });
  });

  test("a countdown to a time of day is already running, against today's mark", () => {
    const clock = initialClock("countdown-to-time", config(), NOW);
    expect(clock).toEqual({ mode: "countdown", state: "running", endsAtMs: resolveTargetMs(600, NOW) });
    // 09:50 -> 10:00 is ten minutes.
    expect(timerDisplaySeconds(clock, NOW, noOverrun)).toBe(600);
  });

  test("a target already past today stays today, so it reads as over rather than as tomorrow", () => {
    const afterTen = new Date(2026, 8, 17, 10, 5, 0, 0).getTime();
    const clock = initialClock("countdown-to-time", config(), afterTen);
    expect(timerDisplaySeconds(clock, afterTen, noOverrun)).toBe(0);
    expect(timerDisplaySeconds(clock, afterTen, overrun)).toBe(-300);
  });

  test("only the two that count from a mark are 'running' without being started", () => {
    expect(isTimerRunning(initialClock("clock", config(), NOW))).toBe(true);
    expect(isTimerRunning(initialClock("countdown-to-time", config(), NOW))).toBe(true);
    expect(isTimerRunning(initialClock("countdown", config(), NOW))).toBe(false);
    expect(isTimerRunning(initialClock("stopwatch", config(), NOW))).toBe(false);
  });
});

describe("the editor's resting clock", () => {
  const afterTen = new Date(2026, 8, 17, 10, 5, 0, 0).getTime();

  test("a target still ahead is the ordinary running count", () => {
    expect(editorRestingClock("countdown-to-time", config(), NOW)).toEqual(
      initialClock("countdown-to-time", config(), NOW),
    );
  });

  test("a target already past rests at a sample value instead of at zero", () => {
    // The bug this exists for: dressing a 10:00 scene in the afternoon showed
    // the END state — the end message in place of the line below, and both
    // hides applied — without the operator ever asking to see it.
    const clock = editorRestingClock("countdown-to-time", config(), afterTen);
    expect(clock).toEqual({ mode: "countdown", state: "held", remainingMs: EDITOR_SAMPLE_REMAINING_MS });
    expect(hasReachedZero(clock, afterTen)).toBe(false);
    // Held, so it cannot count its way into zero while the form is open.
    expect(hasReachedZero(clock, afterTen + 3 * 60 * MINUTE)).toBe(false);
  });

  test("nothing else is touched — only the one tool that rests against a mark", () => {
    for (const tool of ["countdown", "clock", "stopwatch"] as const) {
      expect(editorRestingClock(tool, config(), afterTen)).toEqual(initialClock(tool, config(), afterTen));
    }
  });
});

describe("rounding: a countdown rounds up, a stopwatch rounds down", () => {
  const countdown: TimerClock = { mode: "countdown", state: "running", endsAtMs: NOW + 10_000 };

  test("a 10-second countdown reads 00:10 on its very first frame", () => {
    // A millisecond in, flooring would already say 00:09 — the classic bug.
    expect(formatTimerClock(countdown, NOW + 1, noOverrun)).toBe("00:10");
    expect(formatTimerClock(countdown, NOW + 999, noOverrun)).toBe("00:10");
    expect(formatTimerClock(countdown, NOW + 1_000, noOverrun)).toBe("00:09");
  });

  test("it reaches 00:00 exactly when the time is up", () => {
    expect(formatTimerClock(countdown, NOW + 9_999, noOverrun)).toBe("00:01");
    expect(formatTimerClock(countdown, NOW + 10_000, noOverrun)).toBe("00:00");
  });

  test("a stopwatch stays at 00:00 for its whole first second", () => {
    const stopwatch: TimerClock = { mode: "stopwatch", state: "running", startedAtMs: NOW };
    expect(formatTimerClock(stopwatch, NOW + 999, noOverrun)).toBe("00:00");
    expect(formatTimerClock(stopwatch, NOW + 1_000, noOverrun)).toBe("00:01");
  });
});

describe("zero, and what happens after it", () => {
  const countdown: TimerClock = { mode: "countdown", state: "running", endsAtMs: NOW };

  test("without overrun it rests at 00:00 forever", () => {
    expect(formatTimerClock(countdown, NOW + 90_000, noOverrun)).toBe("00:00");
  });

  test("with overrun it counts into negative numbers", () => {
    expect(formatTimerClock(countdown, NOW + 83_000, overrun)).toBe("-01:23");
  });

  test("the last fraction of a second before -00:01 is 00:00, never '-00:00'", () => {
    expect(formatTimerClock(countdown, NOW + 500, overrun)).toBe("00:00");
    expect(formatTimerClock(countdown, NOW + 1_000, overrun)).toBe("-00:01");
  });

  test("reaching zero is what swaps the end message and the end colour", () => {
    expect(hasReachedZero(countdown, NOW - 1)).toBe(false);
    expect(hasReachedZero(countdown, NOW)).toBe(true);
    // A stopwatch and the wall clock never "reach zero".
    expect(hasReachedZero({ mode: "clock" }, NOW)).toBe(false);
    expect(hasReachedZero({ mode: "stopwatch", state: "running", startedAtMs: NOW }, NOW)).toBe(false);
  });
});

describe("pause and resume are exact inverses", () => {
  test("pausing, waiting thirty seconds and resuming continues thirty seconds LATER", () => {
    const running: TimerClock = { mode: "countdown", state: "running", endsAtMs: NOW + 5 * MINUTE };
    const held = holdClock(running, NOW);
    expect(held).toEqual({ mode: "countdown", state: "held", remainingMs: 5 * MINUTE });

    // The number does not move while it is held, however long that is.
    expect(formatTimerClock(held, NOW + 30_000, noOverrun)).toBe("05:00");

    const resumed = resumeClock(held, NOW + 30_000);
    expect(resumed).toEqual({ mode: "countdown", state: "running", endsAtMs: NOW + 30_000 + 5 * MINUTE });
    expect(formatTimerClock(resumed, NOW + 30_000, noOverrun)).toBe("05:00");
  });

  test("a stopwatch survives the same round trip", () => {
    const running: TimerClock = { mode: "stopwatch", state: "running", startedAtMs: NOW };
    const held = holdClock(running, NOW + 75_000);
    expect(formatTimerClock(held, NOW + 600_000, noOverrun)).toBe("01:15");
    const resumed = resumeClock(held, NOW + 600_000);
    expect(formatTimerClock(resumed, NOW + 601_000, noOverrun)).toBe("01:16");
  });

  test("pausing during overrun keeps the negative value instead of clamping to zero", () => {
    const running: TimerClock = { mode: "countdown", state: "running", endsAtMs: NOW };
    const held = holdClock(running, NOW + 5_000);
    expect(held).toEqual({ mode: "countdown", state: "held", remainingMs: -5_000 });
    expect(formatTimerClock(held, NOW + 60_000, overrun)).toBe("-00:05");
  });

  test("the wall clock has nothing to hold", () => {
    const wall: TimerClock = { mode: "clock" };
    expect(holdClock(wall, NOW)).toBe(wall);
    expect(resumeClock(wall, NOW)).toBe(wall);
  });
});

describe("formatting", () => {
  test("the hours group only appears when it is not zero, if asked", () => {
    expect(formatSignedSeconds(5_400, { hideZeroHours: true })).toBe("1:30:00");
    expect(formatSignedSeconds(90, { hideZeroHours: true })).toBe("01:30");
    expect(formatSignedSeconds(90, { hideZeroHours: false })).toBe("0:01:30");
  });

  test("the wall clock honours the operator's 12/24-hour choice, not the machine's locale", () => {
    const at13 = new Date(2026, 8, 17, 13, 5, 9, 0).getTime();
    expect(formatWallClock(at13, { ...noOverrun, hour12: false, showSeconds: true })).toBe("13:05:09");
    expect(formatWallClock(at13, { ...noOverrun, hour12: false, showSeconds: false })).toBe("13:05");
    expect(formatWallClock(at13, { ...noOverrun, hour12: true, showSeconds: false })).toBe("1:05 PM");
    const atMidnight = new Date(2026, 8, 17, 0, 5, 0, 0).getTime();
    expect(formatWallClock(atMidnight, { ...noOverrun, hour12: true, showSeconds: false })).toBe("12:05 AM");
  });
});

describe("colour triggers", () => {
  const triggers = { warningAtMs: 60_000, warningColor: "#e6a480", endColor: "#e8808d" };
  const countdown: TimerClock = { mode: "countdown", state: "running", endsAtMs: NOW + 5 * MINUTE };

  test("the style's own colour until the threshold, then warning, then end", () => {
    expect(pickValueColor(countdown, NOW, "#ffffff", triggers)).toBe("#ffffff");
    expect(pickValueColor(countdown, NOW + 4 * MINUTE + 1, "#ffffff", triggers)).toBe("#e6a480");
    expect(pickValueColor(countdown, NOW + 5 * MINUTE, "#ffffff", triggers)).toBe("#e8808d");
  });

  test("a scene without triggers never changes colour, and neither does a stopwatch", () => {
    expect(pickValueColor(countdown, NOW + 5 * MINUTE, "#ffffff", null)).toBe("#ffffff");
    const stopwatch: TimerClock = { mode: "stopwatch", state: "running", startedAtMs: NOW };
    expect(pickValueColor(stopwatch, NOW + MINUTE, "#ffffff", triggers)).toBe("#ffffff");
  });
});

describe("the tick lands on the value's own boundary, not on the wall clock's", () => {
  test("a countdown that ends mid-second ticks mid-second", () => {
    // Ends 400 ms past a second, so its digit has to change 400 ms past every
    // second — aligning to the wall clock would be up to 999 ms out.
    const clock: TimerClock = { mode: "countdown", state: "running", endsAtMs: NOW + 9_400 };
    expect(msUntilNextTick(clock, NOW, noOverrun)).toBe(400);
    expect(msUntilNextTick(clock, NOW + 400, noOverrun)).toBe(1_000);
  });

  test("a stopwatch ticks on its own start offset", () => {
    const clock: TimerClock = { mode: "stopwatch", state: "running", startedAtMs: NOW };
    expect(msUntilNextTick(clock, NOW + 250, noOverrun)).toBe(750);
    expect(msUntilNextTick(clock, NOW + 1_000, noOverrun)).toBe(1_000);
  });

  test("overrun keeps ticking past zero; without it, nothing will ever change again", () => {
    const clock: TimerClock = { mode: "countdown", state: "running", endsAtMs: NOW };
    expect(msUntilNextTick(clock, NOW + 500, overrun)).toBe(500);
    expect(msUntilNextTick(clock, NOW + 500, noOverrun)).toBeNull();
  });

  test("a held clock schedules nothing at all", () => {
    expect(msUntilNextTick({ mode: "countdown", state: "held", remainingMs: 1 }, NOW, noOverrun)).toBeNull();
    expect(msUntilNextTick({ mode: "stopwatch", state: "held", elapsedMs: 1 }, NOW, noOverrun)).toBeNull();
  });

  test("a wall clock without seconds waits for the next minute, not the next second", () => {
    const at = new Date(2026, 8, 17, 9, 50, 20, 250).getTime();
    expect(msUntilNextTick({ mode: "clock" }, at, { ...noOverrun, showSeconds: true })).toBe(750);
    expect(msUntilNextTick({ mode: "clock" }, at, { ...noOverrun, showSeconds: false })).toBe(39_750);
  });

  test("a delay can never become a zero-millisecond loop", () => {
    expect(clampTickDelay(0)).toBe(16);
    expect(clampTickDelay(-5)).toBe(16);
    expect(clampTickDelay(999_999)).toBe(60_000);
  });
});

describe("a time of day is resolved against the local calendar", () => {
  test("10:00 today, whatever the machine's timezone offset is", () => {
    const resolved = new Date(resolveTargetMs(10 * 60, NOW));
    expect(resolved.getHours()).toBe(10);
    expect(resolved.getMinutes()).toBe(0);
    expect(resolved.getSeconds()).toBe(0);
    expect(resolved.getDate()).toBe(new Date(NOW).getDate());
  });

  test("a minute outside the day is clamped rather than rolling into another one", () => {
    expect(new Date(resolveTargetMs(-30, NOW)).getDate()).toBe(new Date(NOW).getDate());
    expect(new Date(resolveTargetMs(5_000, NOW)).getDate()).toBe(new Date(NOW).getDate());
  });
});

describe("The editor's two text fields", () => {
  test("a bare number is MINUTES, because every use of this field is «faltan N minutos»", () => {
    expect(parseDuration("10")).toBe(10 * 60_000);
    expect(parseDuration(" 5 ")).toBe(5 * 60_000);
  });

  test("MM:SS and H:MM:SS both parse, and round-trip through the formatter", () => {
    expect(parseDuration("10:00")).toBe(10 * 60_000);
    expect(parseDuration("01:30")).toBe(90_000);
    expect(parseDuration("1:00:00")).toBe(3_600_000);
    expect(formatDuration(10 * 60_000)).toBe("10:00");
    expect(formatDuration(90_000)).toBe("01:30");
    expect(formatDuration(3_600_000)).toBe("1:00:00");
    expect(parseDuration(formatDuration(5_000))).toBe(5_000);
  });

  test("what cannot be read answers null instead of a guess", () => {
    // A field that guesses is a countdown that is wrong on the screen, and the
    // operator finds out in front of the congregation.
    expect(parseDuration("")).toBeNull();
    expect(parseDuration("diez")).toBeNull();
    expect(parseDuration("10:")).toBeNull();
    expect(parseDuration("1:2:3:4")).toBeNull();
    expect(parseDuration("-5")).toBeNull();
  });

  test("a time of day is HH:MM and nothing else", () => {
    expect(parseMinuteOfDay("10:00")).toBe(600);
    expect(parseMinuteOfDay("9:30")).toBe(570);
    expect(parseMinuteOfDay("00:00")).toBe(0);
    expect(parseMinuteOfDay("23:59")).toBe(1439);
    expect(formatMinuteOfDay(600)).toBe("10:00");
    expect(formatMinuteOfDay(570)).toBe("09:30");
  });

  test("an hour that does not exist is rejected rather than wrapped", () => {
    expect(parseMinuteOfDay("25:00")).toBeNull();
    expect(parseMinuteOfDay("10:75")).toBeNull();
    expect(parseMinuteOfDay("1000")).toBeNull();
    expect(parseMinuteOfDay("10:0")).toBeNull();
  });
});

/**
 * The transport bar of a countdown: where the count is inside its own
 * duration, and moving it there.
 *
 * Both exist because the row that draws a countdown is the same
 * `MediaTrackRow` a video uses, and that row speaks in elapsed seconds — while
 * a countdown's own number runs the other way and may be negative. These two
 * are the whole translation, which is why they are here and not in the
 * component.
 */
describe("dragging a countdown", () => {
  const running: TimerClock = { mode: "countdown", state: "running", endsAtMs: NOW + 4 * MINUTE };
  const held: TimerClock = { mode: "countdown", state: "held", remainingMs: 4 * MINUTE };

  test("the bar reads elapsed seconds while the number reads what is left", () => {
    expect(countdownElapsedSeconds(running, NOW, 10 * MINUTE)).toBe(6 * 60);
    expect(timerDisplaySeconds(running, NOW, DEFAULT_TIMER_FORMAT)).toBe(4 * 60);
  });

  test("overrun pins the bar at the end instead of running off it", () => {
    const over: TimerClock = { mode: "countdown", state: "running", endsAtMs: NOW - MINUTE };
    // The number is the one that goes negative — the bar has nowhere past 100%
    // to paint, and a negative width is not a reading of anything.
    expect(countdownElapsedSeconds(over, NOW, 10 * MINUTE)).toBe(10 * 60);
    expect(timerDisplaySeconds(over, NOW, overrun)).toBe(-60);
  });

  test("a seek moves where the count is, never whether it is counting", () => {
    const seeked = seekCountdown(running, 90_000, NOW);
    expect(seeked).toEqual({ mode: "countdown", state: "running", endsAtMs: NOW + 90_000 });
    expect(isTimerRunning(seeked)).toBe(true);

    const paused = seekCountdown(held, 90_000, NOW);
    expect(paused).toEqual({ mode: "countdown", state: "held", remainingMs: 90_000 });
    expect(isTimerRunning(paused)).toBe(false);
  });

  test("dropping the bar where the number already is changes nothing about the value", () => {
    // The round trip the operator actually performs: pick up the thumb at
    // 06:00 and let go without moving it.
    const elapsed = countdownElapsedSeconds(running, NOW, 10 * MINUTE);
    const seeked = seekCountdown(running, 10 * MINUTE - elapsed * 1_000, NOW);
    expect(timerDisplaySeconds(seeked, NOW, DEFAULT_TIMER_FORMAT)).toBe(4 * 60);
  });

  test("a tool with no total has no position, and comes back untouched", () => {
    const stopwatch: TimerClock = { mode: "stopwatch", state: "running", startedAtMs: NOW };
    expect(countdownElapsedSeconds(stopwatch, NOW, 10 * MINUTE)).toBe(0);
    expect(seekCountdown(stopwatch, 1_000, NOW)).toBe(stopwatch);
    expect(seekCountdown({ mode: "clock" }, 1_000, NOW)).toEqual({ mode: "clock" });
  });
});
