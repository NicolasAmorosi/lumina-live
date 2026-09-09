/** Cross-cutting constants shared by main and renderer. */

export const ASSET_KINDS = ["video", "image", "audio", "ppt"] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

/** `pptm`/`ppsx`/`ppsm` are the same OOXML zip as `pptx`; `pps` is the legacy
 *  binary format like `ppt` (the v1 vanilla app accepted both and the TS
 *  migration dropped them). `odp` works now that LibreOffice is the engine. */
export const ASSET_EXTENSIONS: Record<AssetKind, readonly string[]> = {
  video: ["mp4", "mov", "mkv", "avi", "webm"],
  image: ["jpg", "jpeg", "png", "gif", "webp", "bmp"],
  audio: ["mp3", "wav", "ogg", "m4a", "flac"],
  ppt: ["ppt", "pptx", "pptm", "pps", "ppsx", "ppsm", "odp"],
};

export const SERVICE_ITEM_KINDS = ["media", "ppt", "bible", "text"] as const;
export type ServiceItemKind = (typeof SERVICE_ITEM_KINDS)[number];

/** Bump to invalidate every cached deck at once when the conversion pipeline
 *  itself changes (different rasterizer settings, fixed OOXML parsing, …).
 *  Bumped to 2: decks converted before the `soffice` shared-profile race fix
 *  (see .claude/knowledge/soffice-shared-profile-race.md) can be cached with
 *  `timings_source: "none"` and every `advance_ms` null even though the
 *  source file has real timings — only a reconversion recovers them. */
export const SLIDES_CONVERTER_VERSION = 2;

/** Bump to force every non-manual `media_assets` row to re-run
 *  `resolveLinkedAudio` once, next time its deck is opened, even though a
 *  cached result (including a cached "no match") is normally trusted as-is
 *  for performance — resolving a linked audio means reading the whole
 *  source folder and, for legacy binaries, the whole presentation file, so
 *  it must not run on every switch between decks. Bump this whenever the
 *  matching rules in `linked-audio.ts` change, so assets linked under the
 *  old rules (see .claude/knowledge/linked-audio-single-file-fallback-and-manual-override.md)
 *  self-correct without the operator touching each one by hand. */
export const LINKED_AUDIO_RESOLVER_VERSION = 1;
export const SLIDES_THUMB_WIDTH = 320;
export const SLIDES_DEFAULT_RENDER_WIDTH = 1920;
export const SLIDES_MIN_RENDER_WIDTH = 1280;
export const SLIDES_MAX_RENDER_WIDTH = 2560;
export const SLIDES_DEFAULT_CACHE_MB = 4096;
/** PowerPoint permits a 0 ms auto-advance; without a floor a whole deck would
 *  fly past in a single frame. */
export const SLIDES_MIN_ADVANCE_MS = 250;
export const SOFFICE_PROBE_TIMEOUT_MS = 10_000;
export const SLIDES_RASTER_PAGE_TIMEOUT_MS = 30_000;

export const DEFAULT_MEDIA_VOLUME = 0.5;

export const BUILTIN_BIBLE_CODE = "rv1960";
