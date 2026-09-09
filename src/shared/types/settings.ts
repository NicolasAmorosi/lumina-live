import type { AssetKind } from "../constants";
import {
  SLIDES_DEFAULT_CACHE_MB,
  SLIDES_DEFAULT_RENDER_WIDTH,
} from "../constants";

export type Theme = "dark" | "light";
export type Locale = "es" | "it" | "en";
export type SlideImageFormat = "webp" | "png";

export type SettingsMap = {
  "logo.path": string | null;
  "files.lastFolder": string | null;
  "projection.displayId": number | null;
  "ui.theme": Theme;
  "ui.locale": Locale;
  "media.volume": number;
  /** Explicit user override for the LibreOffice binary. When set and invalid,
   *  discovery reports the error instead of silently falling back — a wrong
   *  override must never be invisible. */
  "slides.sofficePath": string | null;
  /** Discovery cache so a cold start skips the candidate walk. */
  "slides.sofficePathResolved": string | null;
  /** Guards the one-time LibreOffice profile warm-up per version. */
  "slides.profileWarmedVersion": string | null;
  "slides.imageFormat": SlideImageFormat;
  "slides.cacheMaxMb": number;
  "slides.maxRenderWidth": number;
  /** Folders the operator has linked per asset kind, so a resource tab can
   *  offer "this folder's files" as an alternative to the added-to-library
   *  list. Files inside are registered like any other asset (so preview/
   *  live/drag all work the same) but never marked `inLibrary`. */
  "library.linkedFolders": Record<AssetKind, string[]>;
  /** Which source view (`"recent"` or one of that kind's linked folder
   *  paths) a resource tab was last left on, restored on next launch. */
  "library.activeView": Record<AssetKind, string>;
};

export const DEFAULT_SETTINGS: SettingsMap = {
  "logo.path": null,
  "files.lastFolder": null,
  "projection.displayId": null,
  "ui.theme": "dark",
  "ui.locale": "es",
  "media.volume": 0.5,
  "slides.sofficePath": null,
  "slides.sofficePathResolved": null,
  "slides.profileWarmedVersion": null,
  "slides.imageFormat": "webp",
  "slides.cacheMaxMb": SLIDES_DEFAULT_CACHE_MB,
  "slides.maxRenderWidth": SLIDES_DEFAULT_RENDER_WIDTH,
  "library.linkedFolders": { video: [], image: [], audio: [], ppt: [] },
  "library.activeView": { video: "recent", image: "recent", audio: "recent", ppt: "recent" },
};
