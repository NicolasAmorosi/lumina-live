/** Cross-cutting constants shared by main and renderer. */

export const ASSET_KINDS = ["video", "image", "audio", "ppt"] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

export const ASSET_EXTENSIONS: Record<AssetKind, readonly string[]> = {
  video: ["mp4", "mov", "mkv", "avi", "webm"],
  image: ["jpg", "jpeg", "png", "gif", "webp", "bmp"],
  audio: ["mp3", "wav", "ogg", "m4a", "flac"],
  ppt: ["ppt", "pptx"],
};

export const PROJECTION_KINDS = [
  "black",
  "logo",
  "image",
  "video",
  "bible",
  "text",
  "ppt",
] as const;
export type ProjectionKind = (typeof PROJECTION_KINDS)[number];

export const SERVICE_ITEM_KINDS = ["media", "ppt", "bible", "text"] as const;
export type ServiceItemKind = (typeof SERVICE_ITEM_KINDS)[number];

export const PPT_POLL_INTERVAL_MS = 800;
export const PPT_OPEN_TIMEOUT_MS = 15_000;
export const PPT_EXPORT_TIMEOUT_MS = 30_000;

export const DEFAULT_MEDIA_VOLUME = 0.5;

export const BUILTIN_BIBLE_CODE = "rv1960";
