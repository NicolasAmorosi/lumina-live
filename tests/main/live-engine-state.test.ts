import { expect, test } from "vitest";
import { liveEngineAudio, liveEngineState } from "../../src/main/media/live-engine-state";
import { INSTANT_TRANSITION, type AudioTrackPush, type ProjectionOutput } from "../../src/shared/types/projection";
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

function track(trackId: string, url: string, paused = false): AudioTrackPush {
  return { trackId, url, epoch: 2, paused, startAtSeconds: 0, volume: 1, loop: false };
}

test("only the audio tracks the engine plays have a session, and a closed projector pauses them", () => {
  const tracks = [track("a", assetUrl(1)), track("b", engineAssetUrl(2)), track("c", engineAssetUrl(3), true)];
  expect(liveEngineAudio(tracks, true).map((t) => [t.trackId, t.paused])).toEqual([
    ["b", false],
    ["c", true],
  ]);
  expect(liveEngineAudio(tracks, false).map((t) => t.paused)).toEqual([true, true]);
});
