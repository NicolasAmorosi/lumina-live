/** What «Test video» concludes about one file on this machine. */
export type VideoProbeVerdict = "smooth" | "risky" | "unsuitable";

/** Why — each one a line under the verdict. `decoderUnknown` never changes
 *  the verdict on its own: it only says the frame count is all there is. */
export type VideoProbeReason =
  | { kind: "noFrames" }
  | { kind: "cpuDecode"; height: number }
  | { kind: "dropped"; percent: number }
  | { kind: "decoderUnknown" };

export type VideoProbeInput = {
  /** `kIsPlatformVideoDecoder`, or `null` when the pipeline could not be read. */
  hardware: boolean | null;
  dropped: number;
  total: number;
  height: number;
};

/** Above this share of dropped frames a video visibly stutters; above the
 *  second one it is not fit for a service on this machine. */
const DROPPED_RISKY = 0.01;
const DROPPED_UNSUITABLE = 0.05;
/** CPU decoding holds up to 1080p on anything recent; past that it is the
 *  stutter the probe exists to catch before a service does. */
const CPU_DECODE_MAX_HEIGHT = 1080;

const RANK: Record<VideoProbeVerdict, number> = { smooth: 0, risky: 1, unsuitable: 2 };

export function classifyVideoProbe(input: VideoProbeInput): {
  verdict: VideoProbeVerdict;
  reasons: VideoProbeReason[];
} {
  if (input.total === 0) return { verdict: "unsuitable", reasons: [{ kind: "noFrames" }] };

  let verdict: VideoProbeVerdict = "smooth";
  const reasons: VideoProbeReason[] = [];
  const raise = (to: VideoProbeVerdict) => {
    if (RANK[to] > RANK[verdict]) verdict = to;
  };

  if (input.hardware === false) {
    reasons.push({ kind: "cpuDecode", height: input.height });
    raise(input.height > CPU_DECODE_MAX_HEIGHT ? "unsuitable" : "risky");
  }
  const ratio = input.dropped / input.total;
  if (ratio > DROPPED_RISKY) {
    reasons.push({ kind: "dropped", percent: Math.round(ratio * 1000) / 10 });
    raise(ratio > DROPPED_UNSUITABLE ? "unsuitable" : "risky");
  }
  if (input.hardware === null) reasons.push({ kind: "decoderUnknown" });
  return { verdict, reasons };
}
