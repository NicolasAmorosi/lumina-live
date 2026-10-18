/**
 * `media-compat` — which files play as they are, and what the rest needs.
 *
 * Every `native`/`convert` expectation below is a measurement, not an opinion:
 * the same container/codec pair was generated with ffmpeg on 2026-10-18 and
 * played in Electron 44's `<video>`, comparing decoded frames and audio bytes.
 * The silent cases (picture with no sound, sound over black) are the ones that
 * matter most, because nothing in the app would ever notice them otherwise.
 *
 * The last block runs the real bundled binaries when `scripts/fetch-ffmpeg.ts`
 * has put them in place, so the argv built here is checked against the FFmpeg
 * the app actually ships, not against what its documentation says.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import {
  conversionArgs,
  normalizeProbe,
  parseProbe,
  parseProgress,
  planPlayback,
  videoFilter,
  type MediaProbe,
} from "../../src/main/media/media-compat";
import type { DecoderSupport } from "../../src/shared/types/media";

const MAC: DecoderSupport = { hevc: true, hevcMain10: true };
const NO_HEVC: DecoderSupport = { hevc: false, hevcMain10: false };

type StreamSpec = Record<string, unknown>;

/** The subset of `ffprobe -show_format -show_streams -print_format json` that
 *  `parseProbe` reads. */
function ffprobe(format: string, ...streams: StreamSpec[]): unknown {
  return {
    format: { format_name: format, duration: "3.000000" },
    streams: streams.map((s, index) => ({ index, disposition: { default: 1, attached_pic: 0 }, ...s })),
  };
}

const v = (codec: string, pix_fmt = "yuv420p", extra: StreamSpec = {}) => ({
  codec_type: "video",
  codec_name: codec,
  pix_fmt,
  width: 640,
  height: 360,
  ...extra,
});
const a = (codec: string, channels = 2) => ({ codec_type: "audio", codec_name: codec, channels });

const MP4 = "mov,mp4,m4a,3gp,3g2,mj2";

function plan(raw: unknown, kind: "video" | "audio" = "video", decoders = MAC) {
  const probe = parseProbe(raw);
  if (!probe) throw new Error("unparseable fixture");
  return planPlayback(probe, kind, decoders);
}

describe("planPlayback — what Chromium already plays", () => {
  test.each([
    ["mp4 h264 + aac", ffprobe(MP4, v("h264"), a("aac"))],
    ["mov h264 + aac", ffprobe(MP4, v("h264"), a("aac"))],
    ["mkv h264 + aac", ffprobe("matroska,webm", v("h264"), a("aac"))],
    ["mkv vp9 + opus", ffprobe("matroska,webm", v("vp9"), a("opus"))],
    ["webm vp8 + opus", ffprobe("matroska,webm", v("vp8"), a("opus"))],
    ["mp4 av1 + aac", ffprobe(MP4, v("av1"), a("aac"))],
    ["mp4 h264 + mp3", ffprobe(MP4, v("h264"), a("mp3"))],
    ["mp4 h264 + flac", ffprobe(MP4, v("h264"), a("flac"))],
    ["mp4 h264, no audio", ffprobe(MP4, v("h264"))],
    ["mp4 hevc on a machine that decodes it", ffprobe(MP4, v("hevc"), a("aac"))],
  ])("%s → native", (_name, raw) => {
    expect(plan(raw)).toEqual({ kind: "native" });
  });

  test.each([
    ["mp3", ffprobe("mp3", a("mp3"))],
    ["m4a aac", ffprobe(MP4, a("aac"))],
    ["flac", ffprobe("flac", a("flac"))],
    ["ogg vorbis", ffprobe("ogg", a("vorbis"))],
    ["opus", ffprobe("ogg", a("opus"))],
    ["adts aac", ffprobe("aac", a("aac"))],
    ["wav s16", ffprobe("wav", a("pcm_s16le"))],
    ["wav s24", ffprobe("wav", a("pcm_s24le"))],
    ["wav f32", ffprobe("wav", a("pcm_f32le"))],
    ["wav u-law", ffprobe("wav", a("pcm_mulaw"))],
  ])("audio %s → native", (_name, raw) => {
    expect(plan(raw, "audio")).toEqual({ kind: "native" });
  });

  test("an MP3's album art is a cover, not an MJPEG video", () => {
    const raw = ffprobe("mp3", a("mp3"), { ...v("mjpeg", "yuvj420p"), disposition: { attached_pic: 1 } });
    expect(plan(raw, "audio")).toEqual({ kind: "native" });
    expect(parseProbe(raw)?.video).toBeNull();
  });

  test("an audio asset ignores a picture stream nobody flagged as a cover", () => {
    expect(plan(ffprobe(MP4, a("aac"), v("mjpeg", "yuvj420p")), "audio")).toEqual({ kind: "native" });
  });
});

describe("planPlayback — what needs converting, and how", () => {
  test.each([
    // Container only: every stream is fine, so this is a seconds-long remux.
    ["avi h264 + mp3", ffprobe("avi", v("h264"), a("mp3")), "copy", "copy"],
    ["flv h264 + aac", ffprobe("flv", v("h264"), a("aac")), "copy", "copy"],
    ["ts h264 + aac", ffprobe("mpegts", v("h264"), a("aac")), "copy", "copy"],
    // Picture Chromium cannot decode.
    ["avi xvid + mp3", ffprobe("avi", v("mpeg4"), a("mp3")), "encode", "copy"],
    ["avi mjpeg + pcm", ffprobe("avi", v("mjpeg", "yuvj420p"), a("pcm_s16le")), "encode", "encode"],
    ["wmv", ffprobe("asf", v("wmv2"), a("wmav2")), "encode", "encode"],
    ["mpg mpeg2 + mp2", ffprobe("mpeg", v("mpeg2video"), a("mp2")), "encode", "encode"],
    ["vob mpeg2 + ac3", ffprobe("mpeg", v("mpeg2video"), a("ac3")), "encode", "encode"],
    // The silent ones: they open, and play only half.
    ["mp4 mpeg4 part 2 (sound over black)", ffprobe(MP4, v("mpeg4"), a("aac")), "encode", "copy"],
    ["mov prores (sound over black)", ffprobe(MP4, v("prores", "yuv422p10le"), a("pcm_s16le")), "encode", "encode"],
    ["mov dnxhd (sound over black)", ffprobe(MP4, v("dnxhd", "yuv422p"), a("pcm_s16le")), "encode", "encode"],
    ["ogv theora (sound over black)", ffprobe("ogg", v("theora"), a("vorbis")), "encode", "encode"],
    ["mp4 h264 + ac3 (picture, no sound)", ffprobe(MP4, v("h264"), a("ac3")), "copy", "encode"],
    ["mkv h264 + dts (picture, no sound)", ffprobe("matroska,webm", v("h264"), a("dts")), "copy", "encode"],
    ["m4v h264 + alac (picture, no sound)", ffprobe(MP4, v("h264"), a("alac")), "copy", "encode"],
    // Not safe on the church's Windows hardware decoders.
    ["h264 4:2:2", ffprobe(MP4, v("h264", "yuv422p"), a("aac")), "encode", "copy"],
    ["h264 High 10", ffprobe(MP4, v("h264", "yuv420p10le"), a("aac")), "encode", "copy"],
    // Opus/Vorbis play natively but do not go into an MP4 without `-strict`.
    ["mkv mpeg4 + opus", ffprobe("matroska,webm", v("mpeg4"), a("opus")), "encode", "encode"],
  ])("%s → video %s, audio %s", (_name, raw, video, audio) => {
    expect(plan(raw)).toEqual({ kind: "convert", video, audio });
  });

  test("HEVC is converted only where this GPU cannot decode it", () => {
    const hevc = ffprobe(MP4, v("hevc"), a("aac"));
    expect(plan(hevc, "video", MAC)).toEqual({ kind: "native" });
    expect(plan(hevc, "video", NO_HEVC)).toEqual({ kind: "convert", video: "encode", audio: "copy" });

    const hevc10 = ffprobe(MP4, v("hevc", "yuv420p10le"), a("aac"));
    expect(plan(hevc10, "video", { hevc: true, hevcMain10: false })).toMatchObject({ video: "encode" });
  });

  test.each([
    ["wma", ffprobe("asf", a("wmav2"))],
    ["aiff", ffprobe("aiff", a("pcm_s16be"))],
    ["ac3", ffprobe("ac3", a("ac3"))],
    ["m4a alac", ffprobe(MP4, a("alac"))],
    ["mp2 in an .mp3", ffprobe("mp3", a("mp2"))],
    ["wav adpcm", ffprobe("wav", a("adpcm_ms"))],
    ["pcm outside a wav", ffprobe(MP4, a("pcm_s16le"))],
  ])("audio %s → encoded to AAC, no picture", (_name, raw) => {
    expect(plan(raw, "audio")).toEqual({ kind: "convert", video: "none", audio: "encode" });
  });

  test("a container whose only stream is fine audio is remuxed, not re-encoded", () => {
    expect(plan(ffprobe("avi", a("mp3")))).toEqual({ kind: "convert", video: "none", audio: "copy" });
  });
});

describe("parseProbe / normalizeProbe", () => {
  test("picks the default audio track, not just the first", () => {
    const raw = {
      format: { format_name: "matroska,webm", duration: "10.5" },
      streams: [
        { index: 0, codec_type: "video", codec_name: "h264", pix_fmt: "yuv420p", width: 1920, height: 1080 },
        { index: 1, codec_type: "audio", codec_name: "ac3", channels: 6, disposition: { default: 0 } },
        { index: 2, codec_type: "audio", codec_name: "aac", channels: 2, disposition: { default: 1 } },
      ],
    };
    expect(parseProbe(raw)).toEqual({
      container: "matroska,webm",
      durationSec: 10.5,
      video: { index: 0, codec: "h264", pixFmt: "yuv420p", width: 1920, height: 1080, colorTransfer: null },
      audio: { index: 2, codec: "aac", channels: 2 },
    });
  });

  test("a file with no usable stream has no probe", () => {
    expect(parseProbe({ format: { format_name: "avi" }, streams: [] })).toBeNull();
    expect(parseProbe({ format: {}, streams: [a("aac")] })).toBeNull();
    expect(parseProbe("garbage")).toBeNull();
  });

  test("what parseProbe writes, normalizeProbe reads back unchanged", () => {
    const probe = parseProbe(ffprobe("avi", v("mpeg4"), a("mp3", 1)));
    expect(normalizeProbe(JSON.parse(JSON.stringify(probe)))).toEqual(probe);
  });

  test("a damaged row is rejected rather than half-trusted", () => {
    expect(normalizeProbe({ container: "avi", video: { codec: "mpeg4" } })).toBeNull();
    expect(normalizeProbe(null)).toBeNull();
  });
});

describe("conversionArgs", () => {
  const probe = parseProbe(ffprobe("avi", v("hevc"), a("ac3", 6))) as MediaProbe;

  test("maps exactly the two chosen streams, and tags copied HEVC for MP4", () => {
    const args = conversionArgs("in.avi", "out.mp4", probe, { kind: "convert", video: "copy", audio: "encode" }, 4);
    expect(args.filter((_arg, i) => args[i - 1] === "-map")).toEqual(["0:0", "0:1"]);
    expect(args).toContain("hvc1");
    expect(args.join(" ")).toContain("-fflags +genpts");
    // 5.1 → stereo, for a two-channel mixer.
    expect(args.join(" ")).toContain("-c:a aac -b:a 192k -ac 2");
    expect(args.slice(-3)).toEqual(["-f", "mp4", "out.mp4"]);
  });

  test("an encode deinterlaces, fits the 1080p box and caps its threads", () => {
    const args = conversionArgs("in.avi", "out.mp4", probe, { kind: "convert", video: "encode", audio: "copy" }, 3);
    const filter = args[args.indexOf("-vf") + 1];
    expect(filter).toContain("bwdif=deint=interlaced");
    expect(filter).toContain("min(1920,iw)");
    expect(filter).not.toContain("tonemap");
    expect(args[args.indexOf("-threads") + 1]).toBe("3");
    expect(args).not.toContain("-fflags");
  });

  test("HDR is tone-mapped on its way to 8-bit", () => {
    const hdr = { index: 0, codec: "hevc", pixFmt: "yuv420p10le", width: 3840, height: 2160, colorTransfer: "smpte2084" };
    expect(videoFilter(hdr)).toContain("tonemap=tonemap=hable");
    expect(videoFilter(hdr).endsWith("format=yuv420p")).toBe(true);
  });
});

describe("parseProgress", () => {
  test("reads the latest out_time_us of a chunk as a fraction", () => {
    expect(parseProgress("frame=10\nout_time_us=500000\nprogress=continue\nout_time_us=1500000\n", 3)).toBe(0.5);
  });

  test("N/A, a missing duration and overshoot are all handled", () => {
    expect(parseProgress("out_time_us=N/A\n", 3)).toBeNull();
    expect(parseProgress("out_time_us=1000000\n", null)).toBeNull();
    expect(parseProgress("out_time_us=9000000\n", 3)).toBe(1);
  });
});

const BIN_DIR = path.resolve("resources/ffmpeg", `${process.platform}-${process.arch}`);
const EXE = process.platform === "win32" ? ".exe" : "";
const FFMPEG = path.join(BIN_DIR, `ffmpeg${EXE}`);
const FFPROBE = path.join(BIN_DIR, `ffprobe${EXE}`);
const haveBinaries = fs.existsSync(FFMPEG) && fs.existsSync(FFPROBE);

describe.skipIf(!haveBinaries)("against the bundled FFmpeg", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "worship-compat-"));
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  function generate(name: string, ...codecArgs: string[]): string {
    const file = path.join(dir, name);
    execFileSync(FFMPEG, [
      ...["-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=2560x1440:rate=25:duration=2"],
      ...["-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-shortest", ...codecArgs, file],
    ]);
    return file;
  }

  function probeFile(file: string): MediaProbe {
    const json = execFileSync(FFPROBE, ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file]);
    const probe = parseProbe(JSON.parse(json.toString("utf8")));
    if (!probe) throw new Error(`no probe for ${file}`);
    return probe;
  }

  function convert(input: string, kind: "video" | "audio"): MediaProbe {
    const probe = probeFile(input);
    const chosen = planPlayback(probe, kind, NO_HEVC);
    if (chosen.kind !== "convert") throw new Error(`${input} unexpectedly native`);
    const output = `${input}.out.mp4`;
    execFileSync(FFMPEG, conversionArgs(input, output, probe, chosen, 2));
    return probeFile(output);
  }

  test("an Xvid AVI comes out as H.264/AAC inside the 1080p box", () => {
    const out = convert(generate("xvid.avi", "-c:v", "mpeg4", "-vtag", "xvid", "-c:a", "libmp3lame"), "video");
    expect(out.container).toContain("mp4");
    expect(out.video).toMatchObject({ codec: "h264", pixFmt: "yuv420p", width: 1920, height: 1080 });
    expect(out.audio?.codec).toBe("mp3");
    expect(planPlayback(out, "video", NO_HEVC)).toEqual({ kind: "native" });
  });

  test("an H.264 AVI is remuxed with its picture untouched", () => {
    const out = convert(generate("h264.avi", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "libmp3lame"), "video");
    expect(out.video).toMatchObject({ codec: "h264", width: 2560, height: 1440 });
    expect(planPlayback(out, "video", NO_HEVC)).toEqual({ kind: "native" });
  });

  test("a 5.1 AC3 track becomes stereo AAC next to a copied picture", () => {
    const input = generate("ac3.mkv", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "ac3", "-ac", "6");
    const out = convert(input, "video");
    expect(out.audio).toMatchObject({ codec: "aac", channels: 2 });
    expect(planPlayback(out, "video", NO_HEVC)).toEqual({ kind: "native" });
  });

  test("a WMA audio file becomes a playable AAC with no picture", () => {
    const input = path.join(dir, "song.wma");
    execFileSync(FFMPEG, ["-loglevel", "error", "-y", "-f", "lavfi", "-i", "sine=duration=2", "-c:a", "wmav2", input]);
    const out = convert(input, "audio");
    expect(out.video).toBeNull();
    expect(out.audio?.codec).toBe("aac");
    expect(planPlayback(out, "audio", NO_HEVC)).toEqual({ kind: "native" });
  });
});
