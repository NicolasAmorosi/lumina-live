/** What Settings → System → Performance reports about the machine's graphics.
 *  The two feature values are Chromium's own strings (`app.getGPUFeatureStatus()`)
 *  — "enabled", "enabled_on", "disabled_software", "unavailable_off"… — passed
 *  through rather than mapped, so what the operator reads out over the phone
 *  is exactly what `chrome://gpu` would say. */
export type GpuStatus = {
  devices: { name: string; active: boolean }[];
  videoDecode: string;
  gpuCompositing: string;
};

/** The Chromium pages the diagnostics panel can open in their own window. */
export const INTERNALS_PAGES = ["gpu", "media-internals"] as const;
export type InternalsPage = (typeof INTERNALS_PAGES)[number];

/** How Chromium decoded the probe video, as its media pipeline reported it
 *  (the same properties `chrome://media-internals` shows). Every field is
 *  nullable: a property the pipeline never reported is unknown, not false. */
export type VideoDecoderReport = {
  decoderName: string | null;
  /** `kIsPlatformVideoDecoder` — the OS/GPU decoder rather than the CPU one. */
  hardware: boolean | null;
  codec: string | null;
  profile: string | null;
  /** Bits per second, as the demuxer estimated it. */
  bitrate: number | null;
};
