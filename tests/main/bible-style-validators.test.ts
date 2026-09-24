/**
 * What main accepts into `settings["bible.style"]`, and what it makes of a row
 * that is already there.
 *
 * The same pairing, with the same opposite tempers, that
 * `scene-validators.test.ts` covers for a time scene — and for the same
 * reason. A verse's style is a JSON blob in a `settings` row: main must refuse
 * a write that does not describe a whole style while the operator is still
 * looking at the form, and must show a row that is ALREADY stored one way or
 * another rather than taking the launch down over a colour.
 */
import { describe, expect, test } from "vitest";
import {
  BIBLE_STYLE_VALIDATORS,
  isBibleStyle,
  normalizeBibleStyle,
} from "../../src/shared/bible-style-validators";
import {
  bibleReferenceLines,
  DEFAULT_BIBLE_STYLE,
  VERSION_SEPARATOR,
  type BibleStyle,
} from "../../src/shared/types/bible-style";
import { SETTINGS_NORMALIZERS, SETTINGS_VALIDATORS } from "../../src/shared/types/settings";

describe("isBibleStyle", () => {
  test("accepts the default", () => {
    expect(isBibleStyle(DEFAULT_BIBLE_STYLE)).toBe(true);
  });

  test("is what the settings key validates with", () => {
    // The whole point of the key having a validator at all: `registerHandlers`
    // casts a `settings:set` request from `unknown` without checking anything.
    expect(SETTINGS_VALIDATORS["bible.style"](DEFAULT_BIBLE_STYLE)).toBe(true);
    expect(SETTINGS_VALIDATORS["bible.style"]({ ...DEFAULT_BIBLE_STYLE, textAlign: "middle" })).toBe(false);
  });

  test("rejects a missing field rather than filling it in", () => {
    const partial: Record<string, unknown> = { ...DEFAULT_BIBLE_STYLE };
    delete partial.autoFit;
    expect(isBibleStyle(partial)).toBe(false);
  });

  test("rejects every field's own bad value", () => {
    const bad: Record<keyof BibleStyle, unknown> = {
      version: 99,
      background: { kind: "solid", color: "red" },
      fontFamily: 'Comic"; color: red',
      verticalAlign: "centre",
      text: { sizeCqw: 0, color: "#fff", weight: 450, shadow: "yes" },
      reference: null,
      textAlign: "middle",
      lineHeight: 0,
      maxWidthCqw: 0,
      showReference: "yes",
      referencePosition: "left",
      referenceCase: "title",
      versionDisplay: "both",
      autoFit: { enabled: true, minSizeCqw: 0 },
    };
    for (const [key, value] of Object.entries(bad)) {
      expect(isBibleStyle({ ...DEFAULT_BIBLE_STYLE, [key]: value })).toBe(false);
      expect(BIBLE_STYLE_VALIDATORS[key as keyof BibleStyle](value)).toBe(false);
    }
  });

  test("rejects a font family that could escape an inline style", () => {
    // Stored in a row that outlives the session and written into an inline
    // style on the projector — "it cannot break out today" is not a reason to
    // store something unquotable. Same predicate `SceneStyle` uses.
    expect(isBibleStyle({ ...DEFAULT_BIBLE_STYLE, fontFamily: 'X"; background: url(evil)' })).toBe(false);
    expect(isBibleStyle({ ...DEFAULT_BIBLE_STYLE, fontFamily: "Georgia" })).toBe(true);
    expect(isBibleStyle({ ...DEFAULT_BIBLE_STYLE, fontFamily: null })).toBe(true);
  });
});

describe("normalizeBibleStyle", () => {
  test("anything unrecognizable becomes the default", () => {
    expect(normalizeBibleStyle(null)).toEqual(DEFAULT_BIBLE_STYLE);
    expect(normalizeBibleStyle("{}")).toEqual(DEFAULT_BIBLE_STYLE);
    expect(normalizeBibleStyle([])).toEqual(DEFAULT_BIBLE_STYLE);
  });

  test("one bad field costs that field and nothing else", () => {
    const stored = {
      ...DEFAULT_BIBLE_STYLE,
      background: { kind: "gradient", from: "#000000", to: "not a colour", direction: "to-bottom" },
      textAlign: "left",
      text: { ...DEFAULT_BIBLE_STYLE.text, color: "#84adfc" },
    };
    const normalized = normalizeBibleStyle(stored);

    expect(normalized.background).toEqual(DEFAULT_BIBLE_STYLE.background);
    // The operator's own choices survive the broken gradient beside them.
    expect(normalized.textAlign).toBe("left");
    expect(normalized.text.color).toBe("#84adfc");
  });

  test("a half-written nested object keeps the halves that parse", () => {
    const normalized = normalizeBibleStyle({
      ...DEFAULT_BIBLE_STYLE,
      autoFit: { enabled: false, minSizeCqw: "big" },
      reference: { sizeCqw: 4, color: "#ffffff", weight: 700, shadow: null },
    });
    expect(normalized.autoFit).toEqual({ enabled: false, minSizeCqw: DEFAULT_BIBLE_STYLE.autoFit.minSizeCqw });
    expect(normalized.reference).toEqual({ sizeCqw: 4, color: "#ffffff", weight: 700, shadow: true });
  });

  test("a row from a future version is read with today's rules, never thrown", () => {
    const normalized = normalizeBibleStyle({ ...DEFAULT_BIBLE_STYLE, version: 7, somethingNew: true });
    expect(normalized.version).toBe(DEFAULT_BIBLE_STYLE.version);
    expect(isBibleStyle(normalized)).toBe(true);
  });

  test("whatever comes out of the normalizer passes the validator", () => {
    // The invariant that lets main normalize on read and validate on write
    // without the two ever disagreeing — the same one `scene-validators`
    // asserts. A normalizer that could emit something its own validator
    // rejects would make a style unsaveable the moment it was read back.
    const inputs: unknown[] = [
      null,
      42,
      {},
      { ...DEFAULT_BIBLE_STYLE, lineHeight: Number.POSITIVE_INFINITY },
      { ...DEFAULT_BIBLE_STYLE, maxWidthCqw: Number.NaN },
      { ...DEFAULT_BIBLE_STYLE, background: { kind: "image", assetId: -4, fit: "cover" } },
      { ...DEFAULT_BIBLE_STYLE, autoFit: null, text: 7, reference: "x" },
    ];
    for (const input of inputs) expect(isBibleStyle(normalizeBibleStyle(input))).toBe(true);
  });

  test("is the normalizer the settings repo actually applies on read", () => {
    expect(SETTINGS_NORMALIZERS["bible.style"]).toBe(normalizeBibleStyle);
  });
});

describe("bibleReferenceLines", () => {
  const withStyle = (patch: Partial<BibleStyle>): BibleStyle => ({ ...DEFAULT_BIBLE_STYLE, ...patch });

  test("hidden means no line at all, not an empty one", () => {
    // An empty paragraph still claims its own leading and the block's gap,
    // which would shift a centred verse off centre for a line nobody sees.
    expect(bibleReferenceLines("Juan 3:16", "RV1960", withStyle({ showReference: false }))).toEqual([]);
  });

  test("the version is folded in, or given its own line, or left out", () => {
    const style = withStyle({ versionDisplay: "inline" });
    expect(bibleReferenceLines("Juan 3:16", "RV1960", style)).toEqual([`Juan 3:16${VERSION_SEPARATOR}RV1960`]);
    expect(bibleReferenceLines("Juan 3:16", "RV1960", withStyle({ versionDisplay: "line" }))).toEqual([
      "Juan 3:16",
      "RV1960",
    ]);
    expect(bibleReferenceLines("Juan 3:16", "RV1960", DEFAULT_BIBLE_STYLE)).toEqual(["Juan 3:16"]);
  });

  test("a verse whose version is gone still reads normally", () => {
    // The FK is `set null`: a program saved before a version was deleted keeps
    // its text and its reference, and only loses the label.
    expect(bibleReferenceLines("Juan 3:16", null, withStyle({ versionDisplay: "inline" }))).toEqual(["Juan 3:16"]);
    expect(bibleReferenceLines("Juan 3:16", null, withStyle({ versionDisplay: "line" }))).toEqual(["Juan 3:16"]);
  });

  test("uppercase applies to the reference and never to the version", () => {
    const lines = bibleReferenceLines("Juan 3:16", "RV1960", withStyle({ referenceCase: "uppercase" }));
    expect(lines).toEqual(["JUAN 3:16"]);
  });
});
