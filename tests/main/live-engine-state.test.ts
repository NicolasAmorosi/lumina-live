import { expect, test } from "vitest";
import { liveEngineState } from "../../src/main/media/live-engine-state";
import { INSTANT_TRANSITION, type ProjectionOutput } from "../../src/shared/types/projection";
import { assetUrl, engineAssetUrl } from "../../src/shared/urls";

function videoOutput(url: string, overrides: Partial<{ kind: "video" | "black"; paused: boolean }> = {}): ProjectionOutput {
  const underlay = { url, epoch: 3, paused: overrides.paused ?? false, startAtSeconds: 12, volume: 0.5 };
  const base = { videoUnderlay: underlay, slideVideo: null, plates: [], transition: INSTANT_TRANSITION };
  return overrides.kind === "black" ? { kind: "black", ...base } : { kind: "video", url, epoch: 3, ...base };
}

test("only a video the engine plays has a session", () => {
  expect(liveEngineState(videoOutput(assetUrl(7)), true)).toBeNull();
  expect(liveEngineState(null, true)).toBeNull();
  expect(liveEngineState(videoOutput(engineAssetUrl(7)), true)).toEqual({
    url: engineAssetUrl(7),
    epoch: 3,
    startAtSeconds: 12,
    paused: false,
    volume: 0.5,
  });
});

test("BLACK/LOGO, the operator's pause and a closed projector all pause it, and keep the session", () => {
  expect(liveEngineState(videoOutput(engineAssetUrl(7), { kind: "black" }), true)?.paused).toBe(true);
  expect(liveEngineState(videoOutput(engineAssetUrl(7), { paused: true }), true)?.paused).toBe(true);
  expect(liveEngineState(videoOutput(engineAssetUrl(7)), false)?.paused).toBe(true);
});
