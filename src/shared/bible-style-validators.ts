/**
 * Runtime validation and defensive normalization for `BibleStyle`.
 *
 * Same two tempers, same two callers, as `scene-validators.ts` — and for once
 * they are not two different modules but two ends of the same key:
 *
 * - **Main validates on WRITE** (`SETTINGS_VALIDATORS["bible.style"]`).
 *   `registerHandlers` casts a `settings:set` request from `unknown` to
 *   `Partial<SettingsMap>` without checking anything, and the renderer is
 *   another process. A stale bundle writing `"textAlign": "middle"` persists a
 *   row no migration will clean up, and the projector would read it on every
 *   launch after that.
 * - **The settings repo normalizes on READ** (`SETTINGS_NORMALIZERS`). A row
 *   written by a future build, hand-edited, or truncated must not take the
 *   launch down and must not come back as a style that projects nothing: every
 *   field falls back INDEPENDENTLY, so one bad colour costs the colour and not
 *   the verse.
 *
 * `Record<keyof BibleStyle, …>` so adding a field without deciding what a
 * valid value is is a compile error, not an unchecked write. And the invariant
 * `scene-validators.ts` holds holds here too: whatever comes out of
 * `normalizeBibleStyle` passes `isBibleStyle`, asserted by a test.
 */
import {
  isBoolean,
  isNumberIn,
  isOneOf,
  isRecord,
  isSceneBackground,
  isTextStyle,
  keepOr,
  matchesAll,
  normalizeTextStyle,
} from "./style-validators";
import {
  BIBLE_AUTOFIT_MAX_CQW,
  BIBLE_AUTOFIT_MIN_CQW,
  BIBLE_LINE_HEIGHT_MAX,
  BIBLE_LINE_HEIGHT_MIN,
  BIBLE_MAX_WIDTH_MAX_CQW,
  BIBLE_MAX_WIDTH_MIN_CQW,
  BIBLE_STYLE_VERSION,
  DEFAULT_BIBLE_STYLE,
  REFERENCE_POSITIONS,
  TEXT_ALIGNS,
  TEXT_CASES,
  VERSION_DISPLAYS,
  type BibleAutoFit,
  type BibleStyle,
} from "./types/bible-style";
import { isSafeFontFamily, SCENE_VERTICAL_ALIGNS } from "./types/scene-style";

const AUTOFIT_VALIDATORS: Record<keyof BibleAutoFit, (v: unknown) => boolean> = {
  enabled: isBoolean,
  minSizeCqw: isNumberIn(BIBLE_AUTOFIT_MIN_CQW, BIBLE_AUTOFIT_MAX_CQW),
};

const isAutoFit = (v: unknown): boolean => matchesAll(v, AUTOFIT_VALIDATORS);

/** Deliberately NOT cross-checked against `text.sizeCqw` here.
 *
 *  A floor above the verse's own size means "shrink to something bigger",
 *  which is not a thing — but it is also not a reason to refuse the write and
 *  leave the operator staring at a form that will not save because of two
 *  fields that are individually fine. It is the RENDERER that resolves it, by
 *  taking the smaller of the two (see `useFittedTextSize`), which degrades to
 *  "no shrinking" — exactly what a floor at the ceiling should mean. */
function normalizeAutoFit(value: unknown, fallback: BibleAutoFit): BibleAutoFit {
  if (!isRecord(value)) return fallback;
  return {
    enabled: keepOr(AUTOFIT_VALIDATORS.enabled(value.enabled), value.enabled, fallback.enabled),
    minSizeCqw: keepOr(
      AUTOFIT_VALIDATORS.minSizeCqw(value.minSizeCqw),
      value.minSizeCqw,
      fallback.minSizeCqw,
    ),
  };
}

export const BIBLE_STYLE_VALIDATORS: Record<keyof BibleStyle, (value: unknown) => boolean> = {
  version: (v) => v === BIBLE_STYLE_VERSION,
  background: isSceneBackground,
  fontFamily: (v) => (v === null || typeof v === "string") && isSafeFontFamily(v),
  verticalAlign: isOneOf(SCENE_VERTICAL_ALIGNS),
  text: isTextStyle,
  reference: isTextStyle,
  textAlign: isOneOf(TEXT_ALIGNS),
  lineHeight: isNumberIn(BIBLE_LINE_HEIGHT_MIN, BIBLE_LINE_HEIGHT_MAX),
  maxWidthCqw: isNumberIn(BIBLE_MAX_WIDTH_MIN_CQW, BIBLE_MAX_WIDTH_MAX_CQW),
  showReference: isBoolean,
  referencePosition: isOneOf(REFERENCE_POSITIONS),
  referenceCase: isOneOf(TEXT_CASES),
  versionDisplay: isOneOf(VERSION_DISPLAYS),
  autoFit: isAutoFit,
};

export function isBibleStyle(value: unknown): value is BibleStyle {
  return matchesAll(value, BIBLE_STYLE_VALIDATORS);
}

/**
 * A `BibleStyle` whatever the input was.
 *
 * Field by field, like `normalizeSceneStyle`: a style whose gradient lost one
 * colour comes back with the default background and the operator's own
 * typography, not as a stranger. `version` is where a future shape change
 * branches — a row declaring a version this build does not know is read with
 * today's rules and falls back wherever it disagrees, which is a verse that
 * projects rather than a launch that throws.
 */
export function normalizeBibleStyle(value: unknown): BibleStyle {
  if (!isRecord(value)) return DEFAULT_BIBLE_STYLE;
  return {
    version: BIBLE_STYLE_VERSION,
    background: keepOr(isSceneBackground(value.background), value.background, DEFAULT_BIBLE_STYLE.background),
    fontFamily: keepOr(
      BIBLE_STYLE_VALIDATORS.fontFamily(value.fontFamily),
      value.fontFamily,
      DEFAULT_BIBLE_STYLE.fontFamily,
    ),
    verticalAlign: keepOr(
      BIBLE_STYLE_VALIDATORS.verticalAlign(value.verticalAlign),
      value.verticalAlign,
      DEFAULT_BIBLE_STYLE.verticalAlign,
    ),
    text: normalizeTextStyle(value.text, DEFAULT_BIBLE_STYLE.text),
    reference: normalizeTextStyle(value.reference, DEFAULT_BIBLE_STYLE.reference),
    textAlign: keepOr(
      BIBLE_STYLE_VALIDATORS.textAlign(value.textAlign),
      value.textAlign,
      DEFAULT_BIBLE_STYLE.textAlign,
    ),
    lineHeight: keepOr(
      BIBLE_STYLE_VALIDATORS.lineHeight(value.lineHeight),
      value.lineHeight,
      DEFAULT_BIBLE_STYLE.lineHeight,
    ),
    maxWidthCqw: keepOr(
      BIBLE_STYLE_VALIDATORS.maxWidthCqw(value.maxWidthCqw),
      value.maxWidthCqw,
      DEFAULT_BIBLE_STYLE.maxWidthCqw,
    ),
    showReference: keepOr(
      isBoolean(value.showReference),
      value.showReference,
      DEFAULT_BIBLE_STYLE.showReference,
    ),
    referencePosition: keepOr(
      BIBLE_STYLE_VALIDATORS.referencePosition(value.referencePosition),
      value.referencePosition,
      DEFAULT_BIBLE_STYLE.referencePosition,
    ),
    referenceCase: keepOr(
      BIBLE_STYLE_VALIDATORS.referenceCase(value.referenceCase),
      value.referenceCase,
      DEFAULT_BIBLE_STYLE.referenceCase,
    ),
    versionDisplay: keepOr(
      BIBLE_STYLE_VALIDATORS.versionDisplay(value.versionDisplay),
      value.versionDisplay,
      DEFAULT_BIBLE_STYLE.versionDisplay,
    ),
    autoFit: normalizeAutoFit(value.autoFit, DEFAULT_BIBLE_STYLE.autoFit),
  };
}
