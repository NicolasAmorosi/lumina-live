/**
 * `frameCaptureSize` — the still of an outgoing video is sized to the stage it
 * fades out on. A 4K frame copied at full size for a 240px monitor was 33 MB
 * drawn synchronously in the commit that starts the transition.
 */
import { describe, expect, test } from "vitest";
import { frameCaptureSize } from "@renderer/lib/frame-capture";

describe("frameCaptureSize", () => {
  test("a 4K frame on a small monitor is captured at the monitor's size", () => {
    expect(frameCaptureSize(3840, 2160, 480, 270)).toEqual({ width: 480, height: 270 });
  });

  test("the aspect ratio is kept inside a box of another shape", () => {
    expect(frameCaptureSize(3840, 2160, 1000, 1000)).toEqual({ width: 1000, height: 563 });
  });

  test("a source smaller than the stage is never upscaled", () => {
    expect(frameCaptureSize(1280, 720, 3840, 2160)).toEqual({ width: 1280, height: 720 });
  });

  test("a box with no size falls back to the source", () => {
    expect(frameCaptureSize(1920, 1080, 0, 0)).toEqual({ width: 1920, height: 1080 });
  });
});
