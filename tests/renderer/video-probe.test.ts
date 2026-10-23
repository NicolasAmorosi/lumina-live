/**
 * `classifyVideoProbe` — «Test video»'s verdict. The case it exists for is a
 * 4K file the GPU cannot decode: that is a CPU decode, and on the machines
 * this app runs on it stutters no matter how few frames the short probe lost.
 */
import { describe, expect, test } from "vitest";
import { classifyVideoProbe } from "@renderer/lib/video-probe";

describe("classifyVideoProbe", () => {
  test("a hardware decode that kept its frames is smooth", () => {
    expect(classifyVideoProbe({ hardware: true, dropped: 0, total: 150, height: 2160 })).toEqual({
      verdict: "smooth",
      reasons: [],
    });
  });

  test("a CPU decode past 1080p is unsuitable even without dropped frames", () => {
    const { verdict, reasons } = classifyVideoProbe({ hardware: false, dropped: 0, total: 150, height: 2160 });
    expect(verdict).toBe("unsuitable");
    expect(reasons).toEqual([{ kind: "cpuDecode", height: 2160 }]);
  });

  test("a CPU decode at 1080p is only a risk", () => {
    expect(classifyVideoProbe({ hardware: false, dropped: 0, total: 150, height: 1080 }).verdict).toBe("risky");
  });

  test("dropped frames raise the verdict by how many were lost", () => {
    expect(classifyVideoProbe({ hardware: true, dropped: 3, total: 150, height: 1080 }).verdict).toBe("risky");
    const heavy = classifyVideoProbe({ hardware: true, dropped: 15, total: 150, height: 1080 });
    expect(heavy.verdict).toBe("unsuitable");
    expect(heavy.reasons).toEqual([{ kind: "dropped", percent: 10 }]);
  });

  test("an unknown decoder is reported but does not change the verdict", () => {
    expect(classifyVideoProbe({ hardware: null, dropped: 0, total: 150, height: 2160 })).toEqual({
      verdict: "smooth",
      reasons: [{ kind: "decoderUnknown" }],
    });
  });

  test("a video that never showed a frame is unsuitable", () => {
    expect(classifyVideoProbe({ hardware: true, dropped: 0, total: 0, height: 0 })).toEqual({
      verdict: "unsuitable",
      reasons: [{ kind: "noFrames" }],
    });
  });
});
