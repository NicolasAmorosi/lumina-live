/**
 * The validation primitives shared by everything the app DRESSES.
 *
 * `SceneStyle` was written to dress three things (see its own header): the
 * utility scenes, the Overlays plates and the Bible verse. Its validators were
 * written for one, and lived as module-private helpers inside
 * `scene-validators.ts` — so the second consumer (`bible-style-validators.ts`)
 * could only have re-declared "what a colour is" and "what a text style is"
 * next to it. Two spellings of the same rule in two files is exactly how a row
 * ends up accepted by one writer and rejected by the other.
 *
 * So the pieces that are genuinely about a STYLE live here, and
 * `scene-validators.ts` keeps what is genuinely about a SCENE (`SceneStyle` as
 * a whole, `TimerConfig`, the upsert). The split is not cosmetic: everything
 * in this file is reachable from both a `utility_scenes` row and a
 * `settings` row, and nothing in it knows either table exists.
 *
 * The two tempers documented in `scene-validators.ts` apply here unchanged —
 * the `is*` predicates are strict (a write the operator is still looking at),
 * the `normalize*` functions are forgiving and fall back FIELD BY FIELD (a row
 * that is already stored has to be shown one way or another).
 */
import {
  BACKGROUND_FITS,
  GRADIENT_DIRECTIONS,
  SCENE_FONT_WEIGHTS,
  type SceneBackground,
  type SceneTextStyle,
} from "./types/scene-style";
import {
  TRANSITION_MAX_DURATION_MS,
  TRANSITION_STYLES,
  type TransitionSpec,
  type TransitionStyle,
} from "./types/transition";

/* -------------------------------------------------------------------------
 * Field-level limits
 * ---------------------------------------------------------------------- */

/** Percent of the output's WIDTH. The floor is "still legible on a confidence
 *  monitor"; the ceiling is "a single glyph does not overflow the frame". */
export const STYLE_TEXT_MIN_CQW = 0.5;
export const STYLE_TEXT_MAX_CQW = 60;

/** `SceneTextStyle.shadowStrength`. Below the floor a shadow is not there;
 *  at the ceiling it is fully black. */
export const STYLE_SHADOW_MIN = 0.1;
export const STYLE_SHADOW_MAX = 1;

/** Exactly `#rrggbb`. One canonical form on purpose: the editor's colour
 *  control only ever emits this, and accepting `#rgb` too would mean two
 *  spellings of the same colour in the database and a comparison that fails
 *  on a value the operator never sees. */
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/* -------------------------------------------------------------------------
 * Primitives
 * ---------------------------------------------------------------------- */

export const isBoolean = (v: unknown): boolean => typeof v === "boolean";

export const isColor = (v: unknown): boolean => typeof v === "string" && HEX_COLOR.test(v);

export const isOneOf =
  (values: readonly (string | number)[]) =>
  (v: unknown): boolean =>
    (typeof v === "string" || typeof v === "number") && values.includes(v);

/** Finite on purpose, for the same reason `SETTINGS_VALIDATORS` says so:
 *  `NaN` and `Infinity` are numbers, survive `JSON.stringify` as `null`, and
 *  come back as a default-shaped hole. */
export const isNumberIn =
  (min: number, max: number) =>
  (v: unknown): boolean =>
    typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;

export const isIntegerIn =
  (min: number, max: number) =>
  (v: unknown): boolean =>
    isNumberIn(min, max)(v) && Number.isInteger(v);

/** Text the operator typed. Empty is allowed here and meaningful: an editor
 *  turns a blank field into `null`, and `null` is what hides a line. */
export const isTextOrNull =
  (maxLength: number) =>
  (v: unknown): boolean =>
    v === null || (typeof v === "string" && v.length <= maxLength);

export const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Every entry of a `Record`-of-validators holds for the same object. */
export function matchesAll(value: unknown, validators: Record<string, (v: unknown) => boolean>): boolean {
  if (!isRecord(value)) return false;
  return Object.entries(validators).every(([key, ok]) => ok(value[key]));
}

/** The one shape a per-field normalizer takes: keep the stored value when its
 *  own validator accepts it, fall back to the sibling default when it does
 *  not. Written once so no normalizer below can accidentally fall back to the
 *  APP default where it meant the row's. */
export function keepOr<T>(ok: boolean, value: unknown, fallback: T): T {
  return ok ? (value as T) : fallback;
}

/* -------------------------------------------------------------------------
 * SceneTextStyle
 * ---------------------------------------------------------------------- */

export const TEXT_STYLE_VALIDATORS: Record<keyof SceneTextStyle, (v: unknown) => boolean> = {
  sizeCqw: isNumberIn(STYLE_TEXT_MIN_CQW, STYLE_TEXT_MAX_CQW),
  color: isColor,
  weight: isOneOf(SCENE_FONT_WEIGHTS),
  shadow: isBoolean,
  shadowStrength: isNumberIn(STYLE_SHADOW_MIN, STYLE_SHADOW_MAX),
};

export const isTextStyle = (v: unknown): boolean => matchesAll(v, TEXT_STYLE_VALIDATORS);

export function normalizeTextStyle(value: unknown, fallback: SceneTextStyle): SceneTextStyle {
  if (!isRecord(value)) return fallback;
  return {
    sizeCqw: keepOr(TEXT_STYLE_VALIDATORS.sizeCqw(value.sizeCqw), value.sizeCqw, fallback.sizeCqw),
    color: keepOr(TEXT_STYLE_VALIDATORS.color(value.color), value.color, fallback.color),
    weight: keepOr(TEXT_STYLE_VALIDATORS.weight(value.weight), value.weight, fallback.weight),
    shadow: keepOr(TEXT_STYLE_VALIDATORS.shadow(value.shadow), value.shadow, fallback.shadow),
    shadowStrength: keepOr(
      TEXT_STYLE_VALIDATORS.shadowStrength(value.shadowStrength),
      value.shadowStrength,
      fallback.shadowStrength,
    ),
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
  if (typeof kind !== "string" || !Object.hasOwn(BACKGROUND_VALIDATORS, kind)) return false;
  return matchesAll(value, BACKGROUND_VALIDATORS[kind as SceneBackground["kind"]]);
}

/* -------------------------------------------------------------------------
 * TransitionSpec
 * ---------------------------------------------------------------------- */

export const TRANSITION_VALIDATORS: Record<keyof TransitionSpec, (v: unknown) => boolean> = {
  style: isOneOf(TRANSITION_STYLES),
  durationMs: isNumberIn(0, TRANSITION_MAX_DURATION_MS),
};

export const isTransitionSpec = (v: unknown): boolean => matchesAll(v, TRANSITION_VALIDATORS);

export function normalizeTransition(value: unknown, fallback: TransitionSpec): TransitionSpec {
  if (!isRecord(value)) return fallback;
  return {
    style: keepOr<TransitionStyle>(TRANSITION_VALIDATORS.style(value.style), value.style, fallback.style),
    durationMs: keepOr(
      TRANSITION_VALIDATORS.durationMs(value.durationMs),
      value.durationMs,
      fallback.durationMs,
    ),
  };
}
