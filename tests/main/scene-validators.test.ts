/**
 * What main accepts into `utility_scenes`, and what it makes of a row that is
 * already there.
 *
 * Two jobs with opposite tempers, which is why they are tested together: the
 * VALIDATORS are strict, because a write that does not describe a whole scene
 * must be refused while the operator is still looking at the form; the
 * NORMALIZERS are forgiving, because a row that is already stored has to be
 * shown one way or another and taking the launch down over it is never the
 * answer.
 */
import { describe, expect, test } from "vitest";
import {
  isSceneBackground,
  isSceneName,
  isSceneStyle,
  isTimerConfig,
  isUtilitySceneUpsert,
  normalizeSceneStyle,
  normalizeTimerConfig,
  SCENE_NAME_MAX_LENGTH,
  SCENE_STYLE_VALIDATORS,
} from "../../src/shared/scene-validators";
import { DEFAULT_SCENE_STYLE, DEFAULT_SHADOW_STRENGTH, type SceneStyle } from "../../src/shared/types/scene-style";
import { DEFAULT_TIMER_FORMAT, type TimerConfig } from "../../src/shared/types/timer";
import { DEFAULT_UTILITY_SCENES } from "../../src/shared/types/utility";

const validConfig: TimerConfig = {
  durationMs: 10 * 60_000,
  targetMinuteOfDay: 600,
  endMessage: null,
  format: DEFAULT_TIMER_FORMAT,
};

describe("Scene background", () => {
  test("accepts each of the three kinds", () => {
    expect(isSceneBackground({ kind: "solid", color: "#04132b" })).toBe(true);
    expect(isSceneBackground({ kind: "gradient", from: "#04132b", to: "#2f557f", direction: "radial" })).toBe(true);
    expect(isSceneBackground({ kind: "image", assetId: 7, fit: "cover" })).toBe(true);
  });

  test("rejects a kind it does not know, and a field of the wrong shape", () => {
    expect(isSceneBackground({ kind: "video", assetId: 7 })).toBe(false);
    expect(isSceneBackground({ kind: "solid", color: "azul" })).toBe(false);
    // Three digits is a colour CSS accepts and this app deliberately does not:
    // two spellings of one colour is a comparison that fails on a value the
    // operator never sees.
    expect(isSceneBackground({ kind: "solid", color: "#fff" })).toBe(false);
    // Asset id 0 is what the editor's "no image chosen yet" state carries, and
    // it must be exactly what stops the row from being saved.
    expect(isSceneBackground({ kind: "image", assetId: 0, fit: "cover" })).toBe(false);
    expect(isSceneBackground({ kind: "image", assetId: 3, fit: "stretch" })).toBe(false);
  });
});

describe("Scene style", () => {
  test("the default style is valid, which is what makes it usable as a fallback", () => {
    expect(isSceneStyle(DEFAULT_SCENE_STYLE)).toBe(true);
  });

  test("a font family that could escape into CSS is rejected rather than sanitized", () => {
    expect(SCENE_STYLE_VALIDATORS.fontFamily(null)).toBe(true);
    expect(SCENE_STYLE_VALIDATORS.fontFamily("Futura")).toBe(true);
    expect(SCENE_STYLE_VALIDATORS.fontFamily('Futura"; color: red')).toBe(false);
    expect(SCENE_STYLE_VALIDATORS.fontFamily("")).toBe(false);
    expect(SCENE_STYLE_VALIDATORS.fontFamily("x".repeat(200))).toBe(false);
  });

  test("a size outside what can be read on a stage is rejected", () => {
    const tooSmall: SceneStyle = { ...DEFAULT_SCENE_STYLE, value: { ...DEFAULT_SCENE_STYLE.value, sizeCqw: 0 } };
    const tooBig: SceneStyle = { ...DEFAULT_SCENE_STYLE, value: { ...DEFAULT_SCENE_STYLE.value, sizeCqw: 200 } };
    expect(isSceneStyle(tooSmall)).toBe(false);
    expect(isSceneStyle(tooBig)).toBe(false);
  });

  test("NaN never passes as a number", () => {
    // It is a number, it survives JSON.stringify as null, and it comes back as
    // a default-shaped hole — the same trap `SETTINGS_VALIDATORS` documents.
    const nan: SceneStyle = { ...DEFAULT_SCENE_STYLE, value: { ...DEFAULT_SCENE_STYLE.value, sizeCqw: Number.NaN } };
    expect(isSceneStyle(nan)).toBe(false);
  });
});

describe("normalizeSceneStyle", () => {
  test("anything that is not an object becomes the default style", () => {
    expect(normalizeSceneStyle(null)).toEqual(DEFAULT_SCENE_STYLE);
    expect(normalizeSceneStyle("{}")).toEqual(DEFAULT_SCENE_STYLE);
    expect(normalizeSceneStyle([])).toEqual(DEFAULT_SCENE_STYLE);
  });

  test("a row stored before the shadow strength existed keeps the shadow it always had", () => {
    const normalized = normalizeSceneStyle({
      ...DEFAULT_SCENE_STYLE,
      value: { sizeCqw: 30, color: "#ff0000", weight: 900, shadow: true },
      title: { ...DEFAULT_SCENE_STYLE.title, shadowStrength: 7 },
    });
    expect(normalized.value.shadowStrength).toBe(DEFAULT_SHADOW_STRENGTH);
    expect(normalized.title.shadowStrength).toBe(DEFAULT_SHADOW_STRENGTH);
    expect(isSceneStyle(normalized)).toBe(true);
    expect(isSceneStyle({ ...DEFAULT_SCENE_STYLE, value: { ...DEFAULT_SCENE_STYLE.value, shadowStrength: 0 } })).toBe(
      false,
    );
  });

  test("one broken field costs that field and nothing else", () => {
    const normalized = normalizeSceneStyle({
      ...DEFAULT_SCENE_STYLE,
      background: { kind: "gradient", from: "#04132b", to: "nope", direction: "to-bottom" },
      verticalAlign: "sideways",
      value: { sizeCqw: 30, color: "#ff0000", weight: 900, shadow: false, shadowStrength: 0.55 },
    });
    expect(normalized.background).toEqual(DEFAULT_SCENE_STYLE.background);
    expect(normalized.verticalAlign).toBe(DEFAULT_SCENE_STYLE.verticalAlign);
    // The half the operator did build is kept.
    expect(normalized.value).toEqual({ sizeCqw: 30, color: "#ff0000", weight: 900, shadow: false, shadowStrength: 0.55 });
  });

  test("a row from a future version is read with today's rules instead of throwing", () => {
    const normalized = normalizeSceneStyle({ ...DEFAULT_SCENE_STYLE, version: 99, unknownField: true });
    expect(normalized.version).toBe(1);
    expect(isSceneStyle(normalized)).toBe(true);
  });

  test("a row written before the end state existed keeps drawing its end message the same way", () => {
    // The fallback is the ROW's own message style, never the app default: a
    // scene saved with a 9cqw message must not start drawing its end message
    // at 4.5 the first time this build reads it.
    const { end: _end, ...withoutEnd } = DEFAULT_SCENE_STYLE;
    const normalized = normalizeSceneStyle({
      ...withoutEnd,
      message: { sizeCqw: 9, color: "#ff0000", weight: 700, shadow: false, shadowStrength: 0.55 },
    });
    expect(normalized.end.message).toEqual({ sizeCqw: 9, color: "#ff0000", weight: 700, shadow: false, shadowStrength: 0.55 });
    // And nothing disappears from a scene that never asked for it.
    expect(normalized.end.hideValue).toBe(false);
    expect(normalized.end.hideTitle).toBe(false);
  });

  test("a row written before the end fade existed keeps cutting straight into its end state", () => {
    // Same rule as the end message above, reached from the other side: there
    // is no sibling field that describes how this scene used to change, so the
    // fallback is the app default — and the app default is "none", which IS
    // the cut every existing scene already did.
    const { transition: _transition, ...endWithoutTransition } = DEFAULT_SCENE_STYLE.end;
    const normalized = normalizeSceneStyle({ ...DEFAULT_SCENE_STYLE, end: endWithoutTransition });
    expect(normalized.end.transition.style).toBe("none");
  });

  test("a broken fade costs the fade and not the rest of the end state", () => {
    const normalized = normalizeSceneStyle({
      ...DEFAULT_SCENE_STYLE,
      end: {
        ...DEFAULT_SCENE_STYLE.end,
        hideValue: true,
        transition: { style: "dissolve-ish", durationMs: 99_000 },
      },
    });
    expect(normalized.end.transition).toEqual(DEFAULT_SCENE_STYLE.end.transition);
    expect(normalized.end.hideValue).toBe(true);
  });

  test("whatever comes out is always valid — that is the contract the repo relies on", () => {
    for (const input of [
      null,
      {},
      { background: 3 },
      { value: { sizeCqw: -1 } },
      { triggers: { warningAtMs: "soon" } },
      { end: { message: { sizeCqw: 0 }, hideValue: "yes" } },
    ]) {
      expect(isSceneStyle(normalizeSceneStyle(input))).toBe(true);
    }
  });
});

describe("Timer config", () => {
  test("accepts a real config and rejects the out-of-range ones", () => {
    expect(isTimerConfig(validConfig)).toBe(true);
    // Under a second cannot be read; a day or more is a typo.
    expect(isTimerConfig({ ...validConfig, durationMs: 500 })).toBe(false);
    expect(isTimerConfig({ ...validConfig, durationMs: 25 * 3_600_000 })).toBe(false);
    expect(isTimerConfig({ ...validConfig, targetMinuteOfDay: 1440 })).toBe(false);
    expect(isTimerConfig({ ...validConfig, targetMinuteOfDay: 10.5 })).toBe(false);
    expect(isTimerConfig({ ...validConfig, format: { ...DEFAULT_TIMER_FORMAT, overrun: "yes" } })).toBe(false);
  });

  test("normalizing keeps every field it can and always answers something valid", () => {
    const normalized = normalizeTimerConfig({ durationMs: 90_000, targetMinuteOfDay: "ten", format: 3 });
    expect(normalized.durationMs).toBe(90_000);
    expect(normalized.targetMinuteOfDay).toBe(600);
    expect(normalized.format).toEqual(DEFAULT_TIMER_FORMAT);
    expect(isTimerConfig(normalized)).toBe(true);
    expect(isTimerConfig(normalizeTimerConfig("{ not json"))).toBe(true);
  });
});

describe("The whole row", () => {
  test("every built-in scene is something main would accept", () => {
    // If a default ever stopped validating, the seed would write rows the
    // editor could not re-save.
    for (const scene of DEFAULT_UTILITY_SCENES) expect(isUtilitySceneUpsert(scene)).toBe(true);
  });

  test("a name has to be readable", () => {
    expect(isSceneName("Cuenta 10")).toBe(true);
    expect(isSceneName("   ")).toBe(false);
    expect(isSceneName("")).toBe(false);
    expect(isSceneName("x".repeat(SCENE_NAME_MAX_LENGTH + 1))).toBe(false);
  });

  test("an id is optional (create) but must be a real row id when present", () => {
    const base = { ...DEFAULT_UTILITY_SCENES[0]! };
    expect(isUtilitySceneUpsert(base)).toBe(true);
    expect(isUtilitySceneUpsert({ ...base, id: 4 })).toBe(true);
    expect(isUtilitySceneUpsert({ ...base, id: 0 })).toBe(false);
    expect(isUtilitySceneUpsert({ ...base, id: "4" })).toBe(false);
  });

  test("an unfinished image background is exactly what stops a save", () => {
    const base = DEFAULT_UTILITY_SCENES[0]!;
    const pending = {
      ...base,
      style: { ...base.style, background: { kind: "image", assetId: 0, fit: "cover" } },
    };
    expect(isUtilitySceneUpsert(pending)).toBe(false);
  });
});
