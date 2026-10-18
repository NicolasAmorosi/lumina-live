import type { AssetKind } from "@shared/constants";
import type { DecoderSupport } from "@shared/types/media";

/**
 * Which files Chromium can play as they are, and what to do with the rest.
 *
 * Pure on purpose — no `electron`, no `child_process` — so the whole decision is
 * unit-tested against the measurements it encodes. Those were taken on
 * 2026-10-18 with Electron 44 on macOS, one generated file per container/codec
 * pair, comparing what ffprobe reported with what a `<video>` actually decoded:
 *
 * - **Containers it opens:** MP4/MOV/M4V/3GP, Matroska/WebM, Ogg, and for audio
 *   MP3, WAV, FLAC and ADTS AAC. AVI, ASF (WMV/WMA), FLV, MPEG-PS (MPG/VOB),
 *   MPEG-TS, AIFF, AC3/DTS elementary streams: `DEMUXER_ERROR_COULD_NOT_OPEN`.
 * - **The dangerous half is silent.** A ProRes, DNxHD, MJPEG, Theora or MPEG-4
 *   part 2 (Xvid/DivX) video inside an MP4/MOV plays its AUDIO over a black
 *   picture, and an AC3/E-AC3/DTS/ALAC/MP2 track plays the picture with no
 *   sound — with no `error` event in either case. That is why this reads the
 *   streams instead of trusting an extension or waiting for the element to
 *   complain.
 *
 * H.264 is only trusted in 8-bit 4:2:0. macOS decoded High 10, 4:2:2 and 4:4:4
 * fine through VideoToolbox, but hardware decoders on Windows do not take
 * them, and the church machine is Windows. HEVC is the one codec whose support
 * depends on the machine's GPU, so it is a parameter (`DecoderSupport`) rather
 * than a constant.
 */

/** What one ffprobe run says about a file, reduced to the facts that decide
 *  playback. Stored as JSON in `media_conversions.probe_json`; bump
 *  `MEDIA_PROBE_VERSION` whenever what is extracted here changes. */
export type MediaProbe = {
  /** ffprobe's `format_name`, a comma list such as `mov,mp4,m4a,3gp,3g2,mj2`. */
  container: string;
  durationSec: number | null;
  video: VideoStreamFacts | null;
  audio: AudioStreamFacts | null;
};

export type VideoStreamFacts = {
  /** Absolute stream index in the file, for `-map 0:<index>`. */
  index: number;
  codec: string;
  pixFmt: string | null;
  width: number;
  height: number;
  /** `smpte2084` (PQ) or `arib-std-b67` (HLG) mean HDR, which needs tone mapping
   *  on the way to 8-bit or it comes out grey and washed. */
  colorTransfer: string | null;
};

export type AudioStreamFacts = {
  index: number;
  codec: string;
  channels: number;
};

export const MEDIA_PROBE_VERSION = 1;

export type StreamAction = "copy" | "encode" | "none";

export type PlaybackPlan =
  | { kind: "native" }
  | {
      kind: "convert";
      video: StreamAction;
      audio: StreamAction;
    };

/** Output frame box for anything that has to be re-encoded: the operator chose
 *  1080p (2026-10-18). A projector at the church is 1080p or less, and a 4K
 *  encode on the CPU of that machine can take longer than the video lasts. */
export const CONVERTED_MAX_WIDTH = 1920;
export const CONVERTED_MAX_HEIGHT = 1080;

const NATIVE_CONTAINERS = new Set(["mp4", "mov", "matroska", "webm", "ogg", "mp3", "wav", "flac", "aac"]);
const NATIVE_AUDIO_CODECS = new Set(["aac", "mp3", "opus", "vorbis", "flac"]);
/** PCM decoded fine in WAV, measured. In MOV only `pcm_s16le` was measured, so
 *  PCM anywhere else is converted — it costs a few seconds of audio encoding
 *  while the picture is copied untouched. */
const WAV_PCM_CODECS = new Set(["pcm_u8", "pcm_s16le", "pcm_s24le", "pcm_s32le", "pcm_f32le", "pcm_mulaw"]);
/** What the MP4 muxer takes without `-strict` and Chromium then plays. VP8 is
 *  missing on purpose: MP4 has no mapping for it. */
const MP4_COPYABLE_VIDEO = new Set(["h264", "hevc", "av1", "vp9"]);
const MP4_COPYABLE_AUDIO = new Set(["aac", "mp3"]);
const HDR_TRANSFERS = new Set(["smpte2084", "arib-std-b67"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function num(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/**
 * ffprobe's `-print_format json -show_format -show_streams` output → the facts
 * above, or null when there is nothing a player could use.
 *
 * The first non-cover video stream and the default audio stream (else the
 * first) are what ffmpeg's own stream selection and Chromium both pick. A
 * cover picture is a video stream flagged `attached_pic` — counting it would
 * make every MP3 with album art look like an MJPEG video.
 */
export function parseProbe(raw: unknown): MediaProbe | null {
  if (!isRecord(raw) || !isRecord(raw.format) || !Array.isArray(raw.streams)) return null;
  const container = str(raw.format.format_name);
  if (!container) return null;

  const streams = raw.streams.filter(isRecord);
  const isCover = (s: Record<string, unknown>) => isRecord(s.disposition) && s.disposition.attached_pic === 1;
  const videoStream = streams.find((s) => s.codec_type === "video" && !isCover(s));
  const audioStreams = streams.filter((s) => s.codec_type === "audio");
  const audioStream =
    audioStreams.find((s) => isRecord(s.disposition) && s.disposition.default === 1) ?? audioStreams[0];

  const video = videoStream ? toVideoFacts(videoStream) : null;
  const audio = audioStream ? toAudioFacts(audioStream) : null;
  if (!video && !audio) return null;

  const durationSec = num(raw.format.duration) ?? num(videoStream?.duration) ?? num(audioStream?.duration);
  return { container, durationSec, video, audio };
}

function toVideoFacts(s: Record<string, unknown>): VideoStreamFacts | null {
  const index = num(s.index);
  const codec = str(s.codec_name);
  if (index === null || !codec) return null;
  return {
    index,
    codec,
    pixFmt: str(s.pix_fmt),
    width: num(s.width) ?? 0,
    height: num(s.height) ?? 0,
    colorTransfer: str(s.color_transfer),
  };
}

function toAudioFacts(s: Record<string, unknown>): AudioStreamFacts | null {
  const index = num(s.index);
  const codec = str(s.codec_name);
  if (index === null || !codec) return null;
  return { index, codec, channels: num(s.channels) ?? 2 };
}

/** Reads back what `parseProbe` wrote, field by field. A row that does not
 *  survive this is re-probed, never trusted. */
export function normalizeProbe(raw: unknown): MediaProbe | null {
  if (!isRecord(raw)) return null;
  const container = str(raw.container);
  if (!container) return null;
  const video = isRecord(raw.video) ? normalizeVideo(raw.video) : null;
  const audio = isRecord(raw.audio) ? normalizeAudio(raw.audio) : null;
  if (!video && !audio) return null;
  return { container, durationSec: num(raw.durationSec), video, audio };
}

function normalizeVideo(v: Record<string, unknown>): VideoStreamFacts | null {
  const index = num(v.index);
  const codec = str(v.codec);
  if (index === null || !codec) return null;
  return {
    index,
    codec,
    pixFmt: str(v.pixFmt),
    width: num(v.width) ?? 0,
    height: num(v.height) ?? 0,
    colorTransfer: str(v.colorTransfer),
  };
}

function normalizeAudio(a: Record<string, unknown>): AudioStreamFacts | null {
  const index = num(a.index);
  const codec = str(a.codec);
  if (index === null || !codec) return null;
  return { index, codec, channels: num(a.channels) ?? 2 };
}

function containerIs(container: string, names: ReadonlySet<string>): boolean {
  return container.split(",").some((name) => names.has(name));
}

function videoPlaysNatively(video: VideoStreamFacts, decoders: DecoderSupport): boolean {
  const eightBit = video.pixFmt === "yuv420p" || video.pixFmt === "yuvj420p";
  const tenBit = video.pixFmt === "yuv420p10le";
  switch (video.codec) {
    case "h264":
      return eightBit;
    case "hevc":
      return eightBit ? decoders.hevc : tenBit && decoders.hevcMain10;
    case "vp8":
      return true;
    case "vp9":
    case "av1":
      return eightBit || tenBit;
    default:
      return false;
  }
}

function audioPlaysNatively(audio: AudioStreamFacts, container: string): boolean {
  if (NATIVE_AUDIO_CODECS.has(audio.codec)) return true;
  return WAV_PCM_CODECS.has(audio.codec) && containerIs(container, new Set(["wav"]));
}

/**
 * Native, or what each stream needs on its way into an MP4.
 *
 * An audio asset never carries a picture: whatever "video" an audio file has
 * that is not flagged as a cover is still artwork, and Chromium ignores it.
 *
 * A file with no stream at all stays `native` — there is nothing to convert,
 * and the projector already reports a file it cannot open.
 */
export function planPlayback(probe: MediaProbe, kind: AssetKind, decoders: DecoderSupport): PlaybackPlan {
  const video = kind === "audio" ? null : probe.video;
  const audio = probe.audio;
  const containerOk = containerIs(probe.container, NATIVE_CONTAINERS);
  const videoOk = video === null || videoPlaysNatively(video, decoders);
  const audioOk = audio === null || audioPlaysNatively(audio, probe.container);
  if (containerOk && videoOk && audioOk) return { kind: "native" };
  if (!video && !audio) return { kind: "native" };

  return {
    kind: "convert",
    video: !video ? "none" : videoOk && MP4_COPYABLE_VIDEO.has(video.codec) ? "copy" : "encode",
    audio: !audio ? "none" : audioOk && MP4_COPYABLE_AUDIO.has(audio.codec) ? "copy" : "encode",
  };
}

/** The same plan with every stream re-encoded — the retry for a remux that
 *  failed, which an AVI with broken timestamps occasionally does. */
export function encodeEverything(plan: PlaybackPlan): PlaybackPlan {
  if (plan.kind === "native") return plan;
  return {
    kind: "convert",
    video: plan.video === "none" ? "none" : "encode",
    audio: plan.audio === "none" ? "none" : "encode",
  };
}

export function planCopiesAnything(plan: PlaybackPlan): boolean {
  return plan.kind === "convert" && (plan.video === "copy" || plan.audio === "copy");
}

/**
 * The filter chain for a re-encoded picture, in the order the work is cheapest:
 *
 * 1. `bwdif=deint=interlaced` touches only frames flagged interlaced, so it is
 *    free on progressive input and removes the combing of DVD, MPG and
 *    camcorder footage — which a projector shows at its worst.
 * 2. Shrink into the 1080p box before anything per-pixel, keeping the aspect
 *    ratio and even dimensions (4:2:0 requires them). A portrait phone video
 *    lands at 608×1080, which is how tall it can be on a 16:9 screen anyway.
 *    The commas inside `min()` are quoted, or the filtergraph parser would
 *    read them as filter separators.
 * 3. HDR only: tone-map to BT.709, or PQ/HLG pixels squeezed into 8-bit come
 *    out grey.
 */
export function videoFilter(video: VideoStreamFacts): string {
  const filters = [
    "bwdif=deint=interlaced",
    `scale=w='min(${CONVERTED_MAX_WIDTH},iw)':h='min(${CONVERTED_MAX_HEIGHT},ih)'` +
      ":force_original_aspect_ratio=decrease:force_divisible_by=2",
  ];
  if (video.colorTransfer !== null && HDR_TRANSFERS.has(video.colorTransfer)) {
    filters.push(
      "zscale=t=linear:npl=100",
      "format=gbrpf32le",
      "zscale=p=bt709",
      "tonemap=tonemap=hable:desat=0",
      "zscale=t=bt709:m=bt709:r=tv",
    );
  }
  filters.push("format=yuv420p");
  return filters.join(",");
}

/**
 * ffmpeg's argv for one conversion. Always MP4 out — `-f mp4` even for an audio
 * asset written as `.m4a`, which is the same container — with `+faststart` so
 * the index sits at the front and a seek never has to read to the end first.
 *
 * `-progress pipe:1` streams `key=value` lines on stdout (see `parseProgress`);
 * errors only on stderr. Encoder threads are capped by the caller: this runs
 * at low priority NEXT to a projector that may be decoding a 4K video.
 */
export function conversionArgs(
  input: string,
  output: string,
  probe: MediaProbe,
  plan: Extract<PlaybackPlan, { kind: "convert" }>,
  threads: number,
): string[] {
  const args = ["-hide_banner", "-nostdin", "-y", "-loglevel", "error", "-progress", "pipe:1", "-nostats"];
  // Stream copy out of AVI/FLV/TS keeps their timestamps, which are sometimes
  // missing on B-frames; regenerating them is what makes the MP4 muxer accept
  // the packets instead of failing the remux.
  if (plan.video === "copy") args.push("-fflags", "+genpts");
  args.push("-i", input);

  if (plan.video !== "none" && probe.video) {
    args.push("-map", `0:${probe.video.index}`);
    if (plan.video === "copy") {
      args.push("-c:v", "copy");
      if (probe.video.codec === "hevc") args.push("-tag:v", "hvc1");
    } else {
      args.push(
        "-vf",
        videoFilter(probe.video),
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "20",
        "-profile:v",
        "high",
        "-threads",
        String(threads),
      );
    }
  }

  if (plan.audio !== "none" && probe.audio) {
    args.push("-map", `0:${probe.audio.index}`);
    if (plan.audio === "copy") args.push("-c:a", "copy");
    else {
      args.push("-c:a", "aac", "-b:a", "192k");
      // Stereo out of 5.1: the church's mixer takes two channels, and an AAC
      // 5.1 track is one more thing a sound system can get wrong.
      if (probe.audio.channels > 2) args.push("-ac", "2");
    }
  }

  args.push("-movflags", "+faststart", "-f", "mp4", output);
  return args;
}

/** The fraction done, from one chunk of `-progress` output, or null when the
 *  chunk says nothing new. `out_time_us` is microseconds (so, despite its
 *  name, is `out_time_ms`, which is why it is not read). */
export function parseProgress(chunk: string, durationSec: number | null): number | null {
  if (durationSec === null || durationSec <= 0) return null;
  let latest: number | null = null;
  for (const match of chunk.matchAll(/^out_time_us=(\d+)$/gm)) latest = Number(match[1]);
  if (latest === null) return null;
  return Math.min(1, Math.max(0, latest / 1_000_000 / durationSec));
}
