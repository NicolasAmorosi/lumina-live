/**
 * How a scripture verse is drawn on the projector.
 *
 * This is the third thing `SceneStyle` was shaped to dress (see its own
 * header, which named it), and it reuses those pieces literally rather than
 * re-describing them: `SceneBackground`, `SceneTextStyle`,
 * `SceneVerticalAlign`, `cssFontFamily` and `cssSceneBackground` are all
 * imported from there. What it does NOT reuse is `SceneStyle` itself, and that
 * is the whole design decision here:
 *
 *   - a time scene has three lines (a number, a line above, a line below) and
 *     an end state; a verse has two (a paragraph and a reference) and no end;
 *   - a countdown's "number" is one short glyph run that never wraps, so it
 *     needs no alignment, no leading and no measuring. A verse is a PARAGRAPH:
 *     Juan 11:35 is two words and Ester 8:9 is eighty, and at a fixed size one
 *     of them is lost in the middle of the frame while the other runs off the
 *     bottom of it.
 *
 * So the four fields a scene has no use for — `textAlign`, `lineHeight`,
 * `maxWidthCqw` and `autoFit` — live here, and the two text roles are named
 * for what they are instead of being bent onto `value`/`title`/`message`.
 *
 * ## Where it is stored
 *
 * One style for the whole app, as the `bible.style` key of `SettingsMap` — not
 * a row per look and not a column on `bible_versions`. It is JSON in a
 * `settings` row for the same reason `utility_scenes.style_json` is JSON: a
 * change of shape is a branch in `bible-style-validators.ts`, not a migration.
 *
 * ## On the hex values below
 *
 * The same exemption `scene-style.ts` documents applies: these are default
 * *content* values that land in a stored row and that the operator edits, not
 * design tokens — so `CLAUDE.md`'s ban on a hardcoded colour in a component is
 * not in play. Every default below reproduces, to the number, what
 * `output-view.tsx` hardcoded before this file existed, so an install that
 * never opens Ajustes projects exactly what it projected yesterday.
 */
import {
  DEFAULT_SHADOW_STRENGTH,
  type SceneBackground,
  type SceneTextStyle,
  type SceneVerticalAlign,
} from "./scene-style";

export const TEXT_ALIGNS = ["left", "center", "right", "justify"] as const;
export type TextAlign = (typeof TEXT_ALIGNS)[number];

export const REFERENCE_POSITIONS = ["above", "below"] as const;
export type ReferencePosition = (typeof REFERENCE_POSITIONS)[number];

export const TEXT_CASES = ["normal", "uppercase"] as const;
export type TextCase = (typeof TEXT_CASES)[number];

/**
 * Where the version's own label goes, if anywhere.
 *
 * "inline" puts it on the reference line after a separator («Juan 3:16 ·
 * RV1909»); "line" gives it a line of its own underneath. Both draw it with
 * the REFERENCE's style rather than a third `SceneTextStyle`: it is the same
 * piece of metadata read at the same moment from the same seats, and a third
 * set of four knobs to configure a label nobody looks at twice is exactly the
 * kind of surface `SceneEnd.message` earned by being read at a DIFFERENT
 * moment and this is not.
 */
export const VERSION_DISPLAYS = ["hidden", "inline", "line"] as const;
export type VersionDisplay = (typeof VERSION_DISPLAYS)[number];

/** The separator between a reference and an inline version label. A literal
 *  and not a setting: it is punctuation, not a decision. */
export const VERSION_SEPARATOR = " · ";

/**
 * Shrink the verse until it fits, down to a floor.
 *
 * The one field in this file that is not a taste: a chapter is not a set of
 * equal-length strings, and `text.sizeCqw` can only ever be right for one
 * length. Without it the operator's only options are a size chosen for the
 * longest verse in the service (which wastes the screen on every other one) or
 * a verse whose tail is simply not on the projector — and the confidence
 * monitor, rendering the same component at the same aspect ratio, clips it
 * identically, so nobody in the booth finds out either.
 *
 * `minSizeCqw` is a floor and not a target: below it the text is small enough
 * that fitting it stops being the point, so the last few words overflow
 * visibly rather than shrinking into illegibility invisibly. It is measured,
 * not computed — see `useFittedTextSize` in `bible-scene.tsx`.
 */
export type BibleAutoFit = {
  enabled: boolean;
  /** Never shrinks past this, in `cqw`. */
  minSizeCqw: number;
};

export const BIBLE_STYLE_VERSION = 1;

export type BibleStyle = {
  version: typeof BIBLE_STYLE_VERSION;
  background: SceneBackground;
  /** `null` = the app's own Noto Sans; anything else is a family installed on
   *  this machine. Rendered only through `cssFontFamily`, exactly like a
   *  scene's, so an uninstalled font degrades instead of disappearing. */
  fontFamily: string | null;
  verticalAlign: SceneVerticalAlign;
  /** The verse itself. */
  text: SceneTextStyle;
  /** The reference line, and the version label when it is shown. */
  reference: SceneTextStyle;
  textAlign: TextAlign;
  /** Unitless, straight onto CSS `line-height`. */
  lineHeight: number;
  /** Percent of the stage's WIDTH the text block may occupy — `cqw` like
   *  every other measurement here, so the 240 px confidence monitor and the
   *  4K projector break the paragraph's lines in the same places. A margin is
   *  not expressed as padding for that reason: padding would have to be
   *  halved by whoever reads it, and a block that is centred at one width and
   *  not the other is a monitor telling the operator something untrue. */
  maxWidthCqw: number;
  showReference: boolean;
  referencePosition: ReferencePosition;
  referenceCase: TextCase;
  versionDisplay: VersionDisplay;
  autoFit: BibleAutoFit;
};

/** The floor's own floor, and its ceiling: a minimum bigger than the verse's
 *  own size would mean "shrink to something larger", which is not a thing. The
 *  editor clamps against `text.sizeCqw`; this pair is what a stored row is
 *  checked against. */
export const BIBLE_AUTOFIT_MIN_CQW = 0.5;
export const BIBLE_AUTOFIT_MAX_CQW = 20;

/** Unitless `line-height`. Below 0.8 the descenders of one line touch the
 *  capitals of the next; above 3 a two-line verse no longer reads as one
 *  sentence. */
export const BIBLE_LINE_HEIGHT_MIN = 0.8;
export const BIBLE_LINE_HEIGHT_MAX = 3;

/** Percent of the stage width. The floor is a column too narrow to read a
 *  sentence in; 100 is edge to edge, which a projector with overscan will
 *  clip — the default leaves the 6 cqw gutter the hardcoded markup had. */
export const BIBLE_MAX_WIDTH_MIN_CQW = 20;
export const BIBLE_MAX_WIDTH_MAX_CQW = 100;

/**
 * Exactly what `output-view.tsx` drew before any of this existed.
 *
 * Deliberately so: this is the value an install that never opens Ajustes gets,
 * and a "better" default would silently restyle every verse of the first
 * service after an update. `text-[3.5cqw] leading-snug font-light`, a
 * `2cqw`/`font-semibold` reference below it, `px-[6cqw]` of gutter (hence
 * `maxWidthCqw: 88`), centred, with the drop shadow on.
 *
 * The one thing that is NOT a reproduction is `autoFit`, which is on: there
 * was no old behaviour to preserve — the old behaviour was a long verse
 * running off the bottom of the projector, which is the defect this field
 * exists to fix and not a look anybody chose.
 *
 * The background is solid black because that is what the stage already was:
 * a `bible` output painted no background of its own and `SceneLayer` is
 * opaque for every kind but `video`, so black is what the layer showed.
 */
export const DEFAULT_BIBLE_STYLE: BibleStyle = {
  version: BIBLE_STYLE_VERSION,
  background: { kind: "solid", color: "#000000" },
  fontFamily: null,
  verticalAlign: "middle",
  text: { sizeCqw: 3.5, color: "#ffffff", weight: 300, shadow: true, shadowStrength: DEFAULT_SHADOW_STRENGTH },
  reference: { sizeCqw: 2, color: "#ffffff", weight: 600, shadow: true, shadowStrength: DEFAULT_SHADOW_STRENGTH },
  textAlign: "center",
  // Tailwind's `leading-snug`.
  lineHeight: 1.375,
  maxWidthCqw: 88,
  showReference: true,
  referencePosition: "below",
  referenceCase: "normal",
  versionDisplay: "hidden",
  autoFit: { enabled: true, minSizeCqw: 1.5 },
};

/**
 * The reference exactly as it should read, version label folded in.
 *
 * Shared rather than inlined in the component for the reason every builder in
 * this app is: the projection window, both confidence monitors and the editor
 * preview all draw this line, and the one that spelled it differently would be
 * the one lying to the operator.
 *
 * Returns `null` when there is no line to draw at all, which the caller uses
 * to skip the element rather than render an empty paragraph that still takes
 * up its own leading.
 */
export function bibleReferenceLines(
  reference: string,
  versionLabel: string | null,
  style: BibleStyle,
): readonly string[] {
  if (!style.showReference) return [];
  const cased = style.referenceCase === "uppercase" ? reference.toLocaleUpperCase() : reference;
  // A version display of "inline"/"line" with nothing to show is the ordinary
  // case, not a hole: a verse dragged into the schedule before its version was
  // deleted has no label left to print (the FK is `set null`), and the
  // reference has to keep reading normally without it.
  if (versionLabel === null || style.versionDisplay === "hidden") return [cased];
  return style.versionDisplay === "inline" ? [`${cased}${VERSION_SEPARATOR}${versionLabel}`] : [cased, versionLabel];
}
