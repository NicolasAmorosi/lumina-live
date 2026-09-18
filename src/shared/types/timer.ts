/**
 * Time, split into the two things it actually is: what the PROJECTOR has to
 * draw, and what the OPERATOR configures.
 *
 * See `plans/2026-09-17-panel-funciones/utilidades.md` for the reasoning; the
 * short version is that the projection window knows nothing about "a countdown
 * to the start of the service". It knows how to subtract against an instant,
 * add from an instant, or read the wall clock — and that is deliberately all,
 * because every alternative either sends a tick per second over IPC or sends a
 * value that is stale the moment the window is rebuilt (the `startAtSeconds`
 * lesson, `.claude/knowledge/startatseconds-is-a-mount-time-seek-so-a-rebuilt-projector-restarts-everything.md`).
 */

/** The four tools the operator picks from. A product-level concept: two of
 *  them collapse onto the same `TimerClock` variant, and the projector never
 *  sees this type at all. */
export const TIMER_TOOLS = ["countdown", "countdown-to-time", "clock", "stopwatch"] as const;
export type TimerTool = (typeof TIMER_TOOLS)[number];

/**
 * What the projection window renders, as an absolute mark it subtracts against
 * its own `Date.now()` once per second.
 *
 * `"held"` covers BOTH "paused" and "not started yet" on purpose: the projector
 * draws the same frozen number either way, so giving it two states it cannot
 * tell apart would be inventing a distinction it has no use for. The control
 * window keeps that distinction for itself (see `TimerRun.started` in
 * `utility.store.ts`), which is where it actually matters — it decides whether
 * the button says START or RESUME.
 *
 * `remainingMs` is deliberately NOT clamped at zero: pausing a countdown that
 * is already 5 seconds into overrun and resuming it has to continue at -5s, not
 * jump back to 00:00.
 */
export type TimerClock =
  | { mode: "countdown"; state: "running"; endsAtMs: number }
  | { mode: "countdown"; state: "held"; remainingMs: number }
  | { mode: "clock" }
  | { mode: "stopwatch"; state: "running"; startedAtMs: number }
  | { mode: "stopwatch"; state: "held"; elapsedMs: number };

/**
 * How to turn a `TimerClock` into characters. Everything here is FORMATTING —
 * a pure function of the same mark the projector is already rendering — which
 * is why it travels to the projection window and is applied there.
 *
 * That includes `overrun`. Having the control window decide "now show a
 * negative number" would mean giving it a clock of its own and a push at the
 * exact instant zero passes: sixty pushes a minute is what this whole design
 * exists to avoid, and a push at that moment would change the
 * `ProjectionOutput` and therefore run a full scene transition one minute
 * before the service starts.
 */
export type TimerFormat = {
  /** Clock and stopwatch only. */
  hour12: boolean;
  /** Clock only — a countdown without seconds is not a countdown. */
  showSeconds: boolean;
  /** Drop the hours group while the value is under an hour: "09:58" reads
   *  better than "00:09:58" on a three-metre screen. */
  hideZeroHours: boolean;
  /** Keep counting past zero, into negative numbers, the way a broadcast
   *  console does. With this off the value rests at 00:00. */
  overrun: boolean;
};

/** What the operator configured. Only `format` and `endMessage` ever reach the
 *  projection window; the rest is what the CONTROL window uses to build the
 *  mark in the first place. */
export type TimerConfig = {
  /** `"countdown"`: how long it runs. */
  durationMs: number;
  /** `"countdown-to-time"`: minutes since local midnight. A number, not a
   *  `"10:00"` string — a number has no format to parse and no timezone to get
   *  wrong. */
  targetMinuteOfDay: number;
  /** Replaces the scene's `message` once the countdown passes zero. `null`
   *  leaves the message alone. */
  endMessage: string | null;
  format: TimerFormat;
};

export const MINUTES_PER_DAY = 1440;
/** A countdown of less than a second cannot be read; one of a day or more is a
 *  typo. Both ends are enforced by the editor and by the row validator. */
export const TIMER_MIN_DURATION_MS = 1_000;
export const TIMER_MAX_DURATION_MS = 23 * 3_600_000 + 59 * 60_000;

export const DEFAULT_TIMER_FORMAT: TimerFormat = {
  hour12: false,
  showSeconds: true,
  hideZeroHours: true,
  overrun: false,
};
