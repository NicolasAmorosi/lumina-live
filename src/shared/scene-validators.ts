/**
 * Runtime validation and defensive normalization for everything a utility
 * scene stores as JSON.
 *
 * Two callers, two different jobs, one set of predicates:
 *
 * - **Main validates on WRITE** (`ipc/handlers/utility.ts`). `registerHandlers`
 *   casts an IPC request from `unknown` to its declared type without checking
 *   anything, and the renderer is another process — a stale bundle after a
 *   partial update writes a durable row no migration will ever clean up. This
 *   is the same reasoning, and the same shape, as `SETTINGS_VALIDATORS`.
 * - **The repo normalizes on READ** (`utility.repo.ts`). A row written by a
 *   future version, hand-edited, or truncated must not take the launch down
 *   with it, and must not come back as a scene that projects nothing: every
 *   field falls back to its default INDEPENDENTLY, so one bad colour costs the
 *   colour and not the whole scene. Same discipline as `DraftRepo.load` and
 *   the Bible seed's parser.
 *
 * `Record<keyof X, …>` throughout, so adding a field to `SceneStyle` or
 * `TimerConfig` without deciding what a valid value is becomes a compile
 * error rather than an unchecked write.
 */
import {
  BACKGROUND_FITS,
  DEFAULT_SCENE_STYLE,
  GRADIENT_DIRECTIONS,
  isSafeFontFamily,
  SCENE_FONT_WEIGHTS,
  SCENE_STYLE_VERSION,
  SCENE_VERTICAL_ALIGNS,
  type SceneBackground,
  type SceneStyle,
  type SceneTextStyle,
  type SceneTriggers,
} from "./types/scene-style";
import {
  DEFAULT_TIMER_FORMAT,
  MINUTES_PER_DAY,
  TIMER_MAX_DURATION_MS,
  TIMER_MIN_DURATION_MS,
  TIMER_TOOLS,
  type TimerConfig,
  type TimerFormat,
} from "./types/timer";
import type { UtilityScene, UtilitySceneUpsert } from "./types/utility";

/* -------------------------------------------------------------------------
 * Field-level limits
 * ---------------------------------------------------------------------- */

/** A scene's name, and the two text lines. Long enough for a real sentence,
 *  short enough that a row can't hold a document. */
export const SCENE_NAME_MAX_LENGTH = 80;
export const SCENE_TEXT_MAX_LENGTH = 200;

/** Percent of the output's WIDTH. The floor is "still legible on a confidence
 *  monitor"; the ceiling is "a single glyph does not overflow the frame". */
export const SCENE_TEXT_MIN_CQW = 0.5;
export const SCENE_TEXT_MAX_CQW = 60;

/** A colour trigger can be armed at most an hour out — past that it is not a
 *  warning, it is the scene's normal colour. */
export const TRIGGER_MAX_WARNING_MS = 3_600_000;

/** Exactly `#rrggbb`. One canonical form on purpose: the editor's colour
 *  control only ever emits this, and accepting `#rgb` too would mean two
 *  spellings of the same colour in the database and a comparison that fails
 *  on a value the operator never sees. */
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/* -------------------------------------------------------------------------
 * Primitives
 * ---------------------------------------------------------------------- */

const isBoolean = (v: unknown): boolean => typeof v === "boolean";

const isColor = (v: unknown): boolean => typeof v === "string" && HEX_COLOR.test(v);

const isOneOf =
  (values: readonly (string | number)[]) =>
  (v: unknown): boolean =>
    (typeof v === "string" || typeof v === "number") && values.includes(v);

/** Finite on purpose, for the same reason `SETTINGS_VALIDATORS` says so:
 *  `NaN` and `Infinity` are numbers, survive `JSON.stringify` as `null`, and
 *  come back as a default-shaped hole. */
const isNumberIn =
  (min: number, max: number) =>
  (v: unknown): boolean =>
    typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;

const isIntegerIn =
  (min: number, max: number) =>
  (v: unknown): boolean =>
    isNumberIn(min, max)(v) && Number.isInteger(v);

/** Text the operator typed. Empty is allowed here and meaningful: the editor
 *  turns a blank field into `null`, and `null` is what hides the line. */
const isTextOrNull =
  (maxLength: number) =>
  (v: unknown): boolean =>
    v === null || (typeof v === "string" && v.length <= maxLength);

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Every entry of a `Record`-of-validators holds for the same object. */
function matchesAll(value: unknown, validators: Record<string, (v: unknown) => boolean>): boolean {
  if (!isRecord(value)) return false;
  return Object.entries(validators).every(([key, ok]) => ok(value[key]));
}

/* -------------------------------------------------------------------------
 * SceneTextStyle
 * ---------------------------------------------------------------------- */

const TEXT_STYLE_VALIDATORS: Record<keyof SceneTextStyle, (v: unknown) => boolean> = {
  sizeCqw: isNumberIn(SCENE_TEXT_MIN_CQW, SCENE_TEXT_MAX_CQW),
  color: isColor,
  weight: isOneOf(SCENE_FONT_WEIGHTS),
  shadow: isBoolean,
};

const isTextStyle = (v: unknown): boolean => matchesAll(v, TEXT_STYLE_VALIDATORS);

function normalizeTextStyle(value: unknown, fallback: SceneTextStyle): SceneTextStyle {
  if (!isRecord(value)) return fallback;
  return {
    sizeCqw: TEXT_STYLE_VALIDATORS.sizeCqw(value.sizeCqw) ? (value.sizeCqw as number) : fallback.sizeCqw,
    color: TEXT_STYLE_VALIDATORS.color(value.color) ? (value.color as string) : fallback.color,
    weight: TEXT_STYLE_VALIDATORS.weight(value.weight)
      ? (value.weight as SceneTextStyle["weight"])
      : fallback.weight,
    shadow: TEXT_STYLE_VALIDATORS.shadow(value.shadow) ? (value.shadow as boolean) : fallback.shadow,
  };
}

/* -------------------------------------------------------------------------
 * SceneBackground
 * ---------------------------------------------------------------------- */

/** One `Record` per variant, keyed by the discriminant, so a fourth kind
 *  cannot be added to `SceneBackground` without listing its fields here. */
const BACKGROUND_VALIDATORS: {
  [K in SceneBackground["kind"]]: Record<
    Exclude<keyof Extract<SceneBackground, { kind: K }>, "kind">,
    (v: unknown) => boolean
  >;
} = {
  solid: { color: isColor },
  gradient: { from: isColor, to: isColor, direction: isOneOf(GRADIENT_DIRECTIONS) },
  // A positive integer, because it is a `media_assets` row id. Whether that
  // row still exists is not a shape question and is deliberately not asked
  // here: the projector resolves a missing asset into a reported image error,
  // exactly like any other picture the operator moved.
  image: { assetId: isIntegerIn(1, Number.MAX_SAFE_INTEGER), fit: isOneOf(BACKGROUND_FITS) },
};

export function isSceneBackground(value: unknown): value is SceneBackground {
  if (!isRecord(value)) return false;
  const kind = value.kind;
  if (typeof kind !== "string" || !(kind in BACKGROUND_VALIDATORS)) return false;
  return matchesAll(value, BACKGROUND_VALIDATORS[kind as SceneBackground["kind"]]);
}

/* -------------------------------------------------------------------------
 * SceneTriggers
 * ---------------------------------------------------------------------- */

const TRIGGER_VALIDATORS: Record<keyof SceneTriggers, (v: unknown) => boolean> = {
  warningAtMs: isNumberIn(0, TRIGGER_MAX_WARNING_MS),
  warningColor: isColor,
  endColor: isColor,
};

const isTriggers = (v: unknown): boolean => v === null || matchesAll(v, TRIGGER_VALIDATORS);

/* -------------------------------------------------------------------------
 * SceneStyle
 * ---------------------------------------------------------------------- */

export const SCENE_STYLE_VALIDATORS: Record<keyof SceneStyle, (value: unknown) => boolean> = {
  version: (v) => v === SCENE_STYLE_VERSION,
  background: isSceneBackground,
  fontFamily: (v) => (v === null || typeof v === "string") && isSafeFontFamily(v),
  verticalAlign: isOneOf(SCENE_VERTICAL_ALIGNS),
  value: isTextStyle,
  title: isTextStyle,
  message: isTextStyle,
  triggers: isTriggers,
};

export function isSceneStyle(value: unknown): value is SceneStyle {
  return matchesAll(value, SCENE_STYLE_VALIDATORS);
}

/**
 * A `SceneStyle` whatever the input was.
 *
 * Field by field rather than all-or-nothing: a scene whose gradient lost one
 * colour should come back with the default background and the operator's own
 * typography, not as a stranger. `version` is where a future shape change
 * branches — a row that declares a version this build does not know is read
 * with today's rules and falls back wherever it disagrees, which is a scene
 * that projects rather than a scene that throws.
 */
export function normalizeSceneStyle(value: unknown): SceneStyle {
  if (!isRecord(value)) return DEFAULT_SCENE_STYLE;
  return {
    version: SCENE_STYLE_VERSION,
    background: isSceneBackground(value.background) ? value.background : DEFAULT_SCENE_STYLE.background,
    fontFamily: SCENE_STYLE_VALIDATORS.fontFamily(value.fontFamily)
      ? (value.fontFamily as string | null)
      : DEFAULT_SCENE_STYLE.fontFamily,
    verticalAlign: SCENE_STYLE_VALIDATORS.verticalAlign(value.verticalAlign)
      ? (value.verticalAlign as SceneStyle["verticalAlign"])
      : DEFAULT_SCENE_STYLE.verticalAlign,
    value: normalizeTextStyle(value.value, DEFAULT_SCENE_STYLE.value),
    title: normalizeTextStyle(value.title, DEFAULT_SCENE_STYLE.title),
    message: normalizeTextStyle(value.message, DEFAULT_SCENE_STYLE.message),
    triggers: isTriggers(value.triggers) ? (value.triggers as SceneTriggers | null) : null,
  };
}

/* -------------------------------------------------------------------------
 * TimerFormat / TimerConfig
 * ---------------------------------------------------------------------- */

export const TIMER_FORMAT_VALIDATORS: Record<keyof TimerFormat, (value: unknown) => boolean> = {
  hour12: isBoolean,
  showSeconds: isBoolean,
  hideZeroHours: isBoolean,
  overrun: isBoolean,
};

export const TIMER_CONFIG_VALIDATORS: Record<keyof TimerConfig, (value: unknown) => boolean> = {
  durationMs: isNumberIn(TIMER_MIN_DURATION_MS, TIMER_MAX_DURATION_MS),
  targetMinuteOfDay: isIntegerIn(0, MINUTES_PER_DAY - 1),
  endMessage: isTextOrNull(SCENE_TEXT_MAX_LENGTH),
  format: (v) => matchesAll(v, TIMER_FORMAT_VALIDATORS),
};

export function isTimerConfig(value: unknown): value is TimerConfig {
  return matchesAll(value, TIMER_CONFIG_VALIDATORS);
}

function normalizeTimerFormat(value: unknown): TimerFormat {
  if (!isRecord(value)) return DEFAULT_TIMER_FORMAT;
  return {
    hour12: isBoolean(value.hour12) ? (value.hour12 as boolean) : DEFAULT_TIMER_FORMAT.hour12,
    showSeconds: isBoolean(value.showSeconds)
      ? (value.showSeconds as boolean)
      : DEFAULT_TIMER_FORMAT.showSeconds,
    hideZeroHours: isBoolean(value.hideZeroHours)
      ? (value.hideZeroHours as boolean)
      : DEFAULT_TIMER_FORMAT.hideZeroHours,
    overrun: isBoolean(value.overrun) ? (value.overrun as boolean) : DEFAULT_TIMER_FORMAT.overrun,
  };
}

/** The `TimerConfig` a row is worth, with the same per-field fallback rule as
 *  `normalizeSceneStyle`. The defaults are the first scene's, not a second set
 *  of magic numbers: ten minutes, ten o'clock, no end message. */
export function normalizeTimerConfig(value: unknown): TimerConfig {
  const fallback: TimerConfig = {
    durationMs: 10 * 60_000,
    targetMinuteOfDay: 10 * 60,
    endMessage: null,
    format: DEFAULT_TIMER_FORMAT,
  };
  if (!isRecord(value)) return fallback;
  return {
    durationMs: TIMER_CONFIG_VALIDATORS.durationMs(value.durationMs)
      ? (value.durationMs as number)
      : fallback.durationMs,
    targetMinuteOfDay: TIMER_CONFIG_VALIDATORS.targetMinuteOfDay(value.targetMinuteOfDay)
      ? (value.targetMinuteOfDay as number)
      : fallback.targetMinuteOfDay,
    endMessage: TIMER_CONFIG_VALIDATORS.endMessage(value.endMessage)
      ? (value.endMessage as string | null)
      : fallback.endMessage,
    format: normalizeTimerFormat(value.format),
  };
}

/* -------------------------------------------------------------------------
 * The whole row
 * ---------------------------------------------------------------------- */

/** A name the list can actually show: not blank, not a paragraph. Trimmed
 *  before the length check, because " " is a name nobody can read. */
export function isSceneName(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0 && value.length <= SCENE_NAME_MAX_LENGTH;
}

const UPSERT_VALIDATORS: Record<keyof Omit<UtilityScene, "id">, (value: unknown) => boolean> = {
  name: isSceneName,
  tool: isOneOf(TIMER_TOOLS),
  config: isTimerConfig,
  style: isSceneStyle,
  title: isTextOrNull(SCENE_TEXT_MAX_LENGTH),
  message: isTextOrNull(SCENE_TEXT_MAX_LENGTH),
};

/**
 * What main accepts as a scene to write.
 *
 * Strict, unlike the normalizers: a request that does not describe a whole
 * valid scene is rejected with an error the operator sees, rather than
 * silently stored as something slightly different from what they built. The
 * normalizers are for rows that are ALREADY in the database and have to be
 * shown anyway.
 */
export function isUtilitySceneUpsert(value: unknown): value is UtilitySceneUpsert {
  if (!matchesAll(value, UPSERT_VALIDATORS)) return false;
  const id = (value as Record<string, unknown>).id;
  return id === undefined || isIntegerIn(1, Number.MAX_SAFE_INTEGER)(id);
}
