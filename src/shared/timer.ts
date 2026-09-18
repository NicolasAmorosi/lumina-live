/**
 * Every time calculation in the app, as pure functions of `(clock, now)`.
 *
 * Zero dependencies and no state on purpose: main, the control window and the
 * projection window all use these, and the projection window using the very
 * same formatter is what keeps the confidence monitors from disagreeing with
 * the projector by a second.
 *
 * `now` is always a parameter, never read from `Date.now()` inside — which is
 * what makes all of this testable without faking timers.
 */
import type { SceneTriggers } from "./types/scene-style";
import type { TimerClock, TimerConfig, TimerFormat, TimerTool } from "./types/timer";
import { MINUTES_PER_DAY } from "./types/timer";

const MS_PER_SECOND = 1_000;
const MS_PER_MINUTE = 60_000;
const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3_600;

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** `mode: "clock"` has no start/stop — the wall clock is always running. */
export function isTimerRunning(clock: TimerClock): boolean {
  return clock.mode === "clock" || clock.state === "running";
}

/** Signed milliseconds the clock is worth right now, before any clamping or
 *  rounding. Positive = time left (countdown) or time spent (stopwatch). */
function rawValueMs(clock: TimerClock, now: number): number {
  switch (clock.mode) {
    case "clock":
      return 0;
    case "countdown":
      return clock.state === "running" ? clock.endsAtMs - now : clock.remainingMs;
    case "stopwatch":
      return clock.state === "running" ? now - clock.startedAtMs : clock.elapsedMs;
  }
}

/**
 * The instant today's `HH:MM` falls on, in local time.
 *
 * Via `setHours` rather than "local midnight + N minutes" so a daylight-saving
 * change on the target day shifts the wall-clock time the operator typed,
 * which is what they meant, instead of the elapsed milliseconds.
 *
 * Deliberately today's occurrence, even when it has already passed: an
 * operator who starts the pre-service countdown at 10:05 for a 10:00 service
 * wants to see 00:00 (or -00:05 with overrun), not a 24-hour countdown.
 */
export function resolveTargetMs(targetMinuteOfDay: number, now: number): number {
  const minute = Math.min(Math.max(Math.round(targetMinuteOfDay), 0), MINUTES_PER_DAY - 1);
  const date = new Date(now);
  date.setHours(Math.floor(minute / 60), minute % 60, 0, 0);
  return date.getTime();
}

/** The clock a scene shows before the operator touches anything. A countdown
 *  and a stopwatch rest at their starting value; the other two are always
 *  running, so they have nothing to start. */
export function initialClock(tool: TimerTool, config: TimerConfig, now: number): TimerClock {
  switch (tool) {
    case "countdown":
      return { mode: "countdown", state: "held", remainingMs: config.durationMs };
    case "countdown-to-time":
      return { mode: "countdown", state: "running", endsAtMs: resolveTargetMs(config.targetMinuteOfDay, now) };
    case "clock":
      return { mode: "clock" };
    case "stopwatch":
      return { mode: "stopwatch", state: "held", elapsedMs: 0 };
  }
}

/**
 * Freezes a running clock at the value it has right now.
 *
 * The result is NOT clamped at zero: a countdown paused five seconds into
 * overrun must resume at -00:05, not at 00:00. Clamping is the formatter's job
 * (and only when `overrun` is off), never the model's.
 */
export function holdClock(clock: TimerClock, now: number): TimerClock {
  switch (clock.mode) {
    case "clock":
      return clock;
    case "countdown":
      return clock.state === "held" ? clock : { mode: "countdown", state: "held", remainingMs: clock.endsAtMs - now };
    case "stopwatch":
      return clock.state === "held"
        ? clock
        : { mode: "stopwatch", state: "held", elapsedMs: Math.max(0, now - clock.startedAtMs) };
  }
}

/** Turns a frozen value back into an absolute mark — the exact inverse of
 *  `holdClock`, which is what makes "pause, wait 30 s, resume" continue 30
 *  seconds later instead of 30 seconds earlier. */
export function resumeClock(clock: TimerClock, now: number): TimerClock {
  switch (clock.mode) {
    case "clock":
      return clock;
    case "countdown":
      return clock.state === "running" ? clock : { mode: "countdown", state: "running", endsAtMs: now + clock.remainingMs };
    case "stopwatch":
      return clock.state === "running" ? clock : { mode: "stopwatch", state: "running", startedAtMs: now - clock.elapsedMs };
  }
}

/**
 * The signed number of seconds to display.
 *
 * A countdown rounds UP and a stopwatch rounds DOWN, and that asymmetry is the
 * point: starting a 10-second countdown has to show 00:10 on the very first
 * frame (by which time only 9.99 s remain, so flooring would show 00:09), and
 * it has to reach 00:00 exactly when the time is up. A stopwatch is the
 * mirror image — it starts at 00:00 and only shows 00:01 once a full second
 * has passed.
 */
export function timerDisplaySeconds(clock: TimerClock, now: number, format: TimerFormat): number {
  const raw = rawValueMs(clock, now);
  switch (clock.mode) {
    case "clock":
      return 0;
    case "countdown": {
      const seconds = Math.ceil(raw / MS_PER_SECOND);
      // `|| 0` normalizes the -0 that `Math.ceil` returns for the last
      // fraction of a second, which would otherwise print as "-00:00".
      return (format.overrun ? seconds : Math.max(0, seconds)) || 0;
    }
    case "stopwatch":
      return Math.max(0, Math.floor(raw / MS_PER_SECOND));
  }
}

/** `[-]H:MM:SS`, or `[-]MM:SS` while under an hour if `hideZeroHours`. */
export function formatSignedSeconds(seconds: number, format: Pick<TimerFormat, "hideZeroHours">): string {
  const total = Math.abs(seconds);
  const hours = Math.floor(total / SECONDS_PER_HOUR);
  const minutes = Math.floor((total % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
  const body =
    hours === 0 && format.hideZeroHours
      ? `${pad2(minutes)}:${pad2(total % SECONDS_PER_MINUTE)}`
      : `${hours}:${pad2(minutes)}:${pad2(total % SECONDS_PER_MINUTE)}`;
  return seconds < 0 ? `-${body}` : body;
}

/** The wall clock, for `mode: "clock"`. Hand-formatted rather than through
 *  `Intl`: the operator picked 12 or 24 hours explicitly, and a locale-derived
 *  format would quietly disagree with that choice on someone else's machine. */
export function formatWallClock(now: number, format: TimerFormat): string {
  const date = new Date(now);
  const hours24 = date.getHours();
  const hours = format.hour12 ? hours24 % 12 || 12 : hours24;
  const parts = [format.hour12 ? String(hours) : pad2(hours), pad2(date.getMinutes())];
  if (format.showSeconds) parts.push(pad2(date.getSeconds()));
  return format.hour12 ? `${parts.join(":")} ${hours24 < 12 ? "AM" : "PM"}` : parts.join(":");
}

/** The characters the projector paints. One function for all three modes, so
 *  the monitors and the projector cannot drift. */
export function formatTimerClock(clock: TimerClock, now: number, format: TimerFormat): string {
  return clock.mode === "clock"
    ? formatWallClock(now, format)
    : formatSignedSeconds(timerDisplaySeconds(clock, now, format), format);
}

/** A countdown that is at or past zero. Drives the end-message swap and the
 *  end colour — both formatting, both derived from the same mark. */
export function hasReachedZero(clock: TimerClock, now: number): boolean {
  return clock.mode === "countdown" && rawValueMs(clock, now) <= 0;
}

/** The colour the big number should be drawn in: the style's own, unless a
 *  trigger threshold has been crossed. */
export function pickValueColor(
  clock: TimerClock,
  now: number,
  defaultColor: string,
  triggers: SceneTriggers | null,
): string {
  if (!triggers || clock.mode !== "countdown") return defaultColor;
  const remaining = rawValueMs(clock, now);
  if (remaining <= 0) return triggers.endColor;
  return remaining <= triggers.warningAtMs ? triggers.warningColor : defaultColor;
}

/**
 * How long until the rendered text changes, or `null` when it never will
 * again (a held clock, or a countdown resting at 00:00 with overrun off).
 *
 * This is why a re-armed timeout beats `setInterval`: the delay is measured to
 * the next boundary of THIS clock, not to the next wall-clock second. A
 * countdown that ends at 10:00:00.400 changes its digit 400 ms past every
 * second, and aligning to the wall clock instead would make the last second
 * tick up to 999 ms early or late — visible next to a stopwatch, and wrong at
 * exactly the moment anybody is watching.
 *
 * Reading `Date.now()` afresh on every tick is also what makes a throttled
 * window self-correct: Chromium cuts a hidden page's timers to one per minute
 * after five minutes, and an occluded Electron window has no rendering
 * lifecycle at all (`.claude/knowledge/occluded-electron-window-has-no-rendering-lifecycle.md`),
 * so the value must never be derived by decrementing a counter.
 */
export function msUntilNextTick(clock: TimerClock, now: number, format: TimerFormat): number | null {
  switch (clock.mode) {
    case "clock": {
      const date = new Date(now);
      const untilNextSecond = MS_PER_SECOND - date.getMilliseconds();
      // Seconds and milliseconds are offset-invariant (even in the :30 and
      // :45 timezones), so this aligns to the local minute without knowing
      // the offset.
      return format.showSeconds
        ? untilNextSecond
        : (SECONDS_PER_MINUTE - 1 - date.getSeconds()) * MS_PER_SECOND + untilNextSecond;
    }
    case "countdown": {
      if (clock.state === "held") return null;
      const remaining = clock.endsAtMs - now;
      if (remaining <= 0 && !format.overrun) return null;
      const offset = remaining % MS_PER_SECOND;
      return offset <= 0 ? offset + MS_PER_SECOND : offset;
    }
    case "stopwatch": {
      if (clock.state === "held") return null;
      const elapsed = now - clock.startedAtMs;
      // A start mark in the future can only come from the system clock moving
      // backwards mid-count; waiting it out is better than spinning.
      if (elapsed < 0) return -elapsed;
      return MS_PER_SECOND - (elapsed % MS_PER_SECOND);
    }
  }
}

/** Clamps whatever `msUntilNextTick` produced into a delay a timer can safely
 *  be armed with — a bad value must never turn into a 0 ms loop, and a
 *  minute-resolution clock still checks in once a minute. */
export function clampTickDelay(delay: number): number {
  return Math.max(16, Math.min(Math.round(delay), MS_PER_MINUTE));
}

/* -------------------------------------------------------------------------
 * The editor's two text fields
 *
 * A duration and a time of day are stored as numbers (`durationMs`,
 * `targetMinuteOfDay`) precisely so nothing downstream has to parse them — but
 * the operator types them, so exactly one layer has to convert, and it is this
 * one. Both parsers answer `null` rather than a guess: a field that cannot be
 * read must refuse to save, not save something the operator did not mean.
 * ---------------------------------------------------------------------- */

/** `MM:SS`, or `H:MM:SS` from an hour up — the same shape the projector draws,
 *  so what the operator types reads back the way they will see it. */
export function formatDuration(durationMs: number): string {
  return formatSignedSeconds(Math.max(0, Math.round(durationMs / MS_PER_SECOND)), { hideZeroHours: true });
}

/**
 * `"10"` (ten minutes), `"10:00"` (`MM:SS`) or `"1:00:00"` (`H:MM:SS`) as
 * milliseconds; `null` when it is not one of those.
 *
 * A bare number means MINUTES, not seconds: every use of this field is "the
 * service starts in N minutes", and a 10 that meant ten seconds would be a
 * countdown nobody notices was wrong until it is on the screen. The parts past
 * the first are not range-checked individually — `90` seconds is read as a
 * minute and a half, the way a stopwatch entry normally behaves — but the
 * total is, by the caller, against `TIMER_MIN/MAX_DURATION_MS`.
 */
export function parseDuration(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const parts = trimmed.split(":");
  if (parts.length > 3) return null;
  const numbers = parts.map((part) => (/^\d{1,3}$/.test(part.trim()) ? Number(part.trim()) : Number.NaN));
  if (numbers.some((n) => !Number.isFinite(n))) return null;
  if (numbers.length === 1) return numbers[0]! * MS_PER_MINUTE;
  const seconds = numbers.reverse().reduce((total, value, index) => total + value * 60 ** index, 0);
  return seconds * MS_PER_SECOND;
}

/** Minutes since local midnight as `HH:MM`, always zero-padded — it is going
 *  into a field the operator edits, and a jumping width is the same nuisance
 *  `tabular-nums` exists to stop. */
export function formatMinuteOfDay(minuteOfDay: number): string {
  const minute = Math.min(Math.max(Math.round(minuteOfDay), 0), MINUTES_PER_DAY - 1);
  return `${pad2(Math.floor(minute / 60))}:${pad2(minute % 60)}`;
}

/** `"HH:MM"` (or `"H:MM"`) as minutes since midnight; `null` for anything
 *  else, including an hour past 23 or a minute past 59 — a wall-clock time has
 *  no reading in which `25:00` means something. */
export function parseMinuteOfDay(text: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}
