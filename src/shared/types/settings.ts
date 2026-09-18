import type { AssetKind } from "../constants";
import {
  ASSET_KINDS,
  SLIDES_DEFAULT_CACHE_MB,
  SLIDES_DEFAULT_RENDER_WIDTH,
} from "../constants";
import { MEDIA_SORT_ORDERS, type MediaSortOrder } from "./media";
import { TRANSITION_STYLES, type TransitionStyle } from "./projection";

export const THEMES = ["dark", "light"] as const;
export type Theme = (typeof THEMES)[number];

export const LOCALES = ["es", "it", "en"] as const;
export type Locale = (typeof LOCALES)[number];

export const SLIDE_IMAGE_FORMATS = ["webp", "png"] as const;
export type SlideImageFormat = (typeof SLIDE_IMAGE_FORMATS)[number];

export type SettingsMap = {
  "logo.path": string | null;
  "files.lastFolder": string | null;
  "projection.displayId": number | null;
  "ui.theme": Theme;
  "ui.locale": Locale;
  "media.volume": number;
  /** How the projector moves between scenes — see `TransitionStyle`. */
  "projection.transition.style": TransitionStyle;
  /** Ignored when the style is "none". */
  "projection.transition.durationMs": number;
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
  /** Internal escape hatch (no UI control): lets a background prewarm job be
   *  soft-interrupted when the operator opens something interactively.
   *  Killing `soffice` mid-conversion carries a small risk of leaving its
   *  profile locked (see `.claude/knowledge/soffice-shared-profile-race.md`)
   *  — set to `false` to degrade to plain priority ordering (no preemption)
   *  without a release, if that risk ever needs to go to zero. */
  "slides.preemptBackground": boolean;
  /** Folders the operator has linked per asset kind, so a resource tab can
   *  offer "this folder's files" as an alternative to the added-to-library
   *  list. Files inside are registered like any other asset (so preview/
   *  live/drag all work the same) but never marked `inLibrary`. */
  "library.linkedFolders": Record<AssetKind, string[]>;
  /** Which source view (`"recent"` or one of that kind's linked folder
   *  paths) a resource tab was last left on, restored on next launch. */
  "library.activeView": Record<AssetKind, string>;
  /** How each resource tab's grid is ordered. Per kind rather than global:
   *  a folder of hymn decks is browsed by name, a folder of sermon videos by
   *  date, and the operator should not have to re-pick on every switch. */
  "library.sort": Record<AssetKind, MediaSortOrder>;
};

export const DEFAULT_SETTINGS: SettingsMap = {
  "logo.path": null,
  "files.lastFolder": null,
  "projection.displayId": null,
  "ui.theme": "dark",
  "ui.locale": "es",
  "media.volume": 0.5,
  "projection.transition.style": "crossfade",
  "projection.transition.durationMs": 300,
  "slides.sofficePath": null,
  "slides.sofficePathResolved": null,
  "slides.profileWarmedVersion": null,
  "slides.imageFormat": "webp",
  "slides.cacheMaxMb": SLIDES_DEFAULT_CACHE_MB,
  "slides.maxRenderWidth": SLIDES_DEFAULT_RENDER_WIDTH,
  "slides.preemptBackground": true,
  "library.linkedFolders": { video: [], image: [], audio: [], ppt: [] },
  "library.activeView": { video: "recent", image: "recent", audio: "recent", ppt: "recent" },
  "library.sort": { video: "name-asc", image: "name-asc", audio: "name-asc", ppt: "name-asc" },
};

/* -------------------------------------------------------------------------
 * Runtime validation
 *
 * `SettingsMap` is erased at build time, and `registerHandlers` casts the IPC
 * request from `unknown` to the declared type without checking anything. The
 * renderer is another process: a stale bundle after a partial update, or a
 * `Record` built wrong, writes a durable row no migration will ever clean up.
 * `"ui.theme": "purple"` persists, is read at startup, lands in
 * `document.documentElement.dataset.theme` and leaves the app with NO theme
 * applied until someone edits the database by hand.
 *
 * One predicate per key, next to the defaults so a new setting cannot be added
 * without one — `Record<keyof SettingsMap, ...>` makes a missing entry a
 * compile error. No new dependency: the key list already exists right above.
 * ---------------------------------------------------------------------- */

const isString = (v: unknown): boolean => typeof v === "string";
const isBoolean = (v: unknown): boolean => typeof v === "boolean";
const isNullOr =
  (inner: (v: unknown) => boolean) =>
  (v: unknown): boolean =>
    v === null || inner(v);
const isOneOf =
  (values: readonly string[]) =>
  (v: unknown): boolean =>
    typeof v === "string" && values.includes(v);

/** Finite on purpose: `NaN` and `Infinity` are numbers, survive
 *  `JSON.stringify` as `null`, and come back as a default-shaped hole. */
const isNumberIn =
  (min: number, max: number) =>
  (v: unknown): boolean =>
    typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;

/** A display id is an OS handle, not a measurement: it only has to be a
 *  positive integer for `screen.getAllDisplays()` to ever match it. The string
 *  `"2"` that a mis-built form would send never equals any `d.id`, and the
 *  projector silently falls back to the default screen forever. */
const isDisplayId = (v: unknown): boolean => v === null || (typeof v === "number" && Number.isInteger(v) && v >= 0);

const isRecordOfKinds =
  (valueOk: (v: unknown) => boolean) =>
  (v: unknown): boolean => {
    if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
    const record = v as Record<string, unknown>;
    // Exactly the four kinds: an extra key is a caller that has drifted from
    // `AssetKind`, and a missing one is a `Record` that will read `undefined`
    // on the tab it forgot.
    if (Object.keys(record).length !== ASSET_KINDS.length) return false;
    return ASSET_KINDS.every((kind) => kind in record && valueOk(record[kind]));
  };

const isStringArray = (v: unknown): boolean => Array.isArray(v) && v.every(isString);

export const SETTINGS_VALIDATORS: Record<keyof SettingsMap, (value: unknown) => boolean> = {
  "logo.path": isNullOr(isString),
  "files.lastFolder": isNullOr(isString),
  "projection.displayId": isDisplayId,
  "ui.theme": isOneOf(THEMES),
  "ui.locale": isOneOf(LOCALES),
  "media.volume": isNumberIn(0, 1),
  "projection.transition.style": isOneOf(TRANSITION_STYLES),
  "projection.transition.durationMs": isNumberIn(0, 5_000),
  "slides.sofficePath": isNullOr(isString),
  "slides.sofficePathResolved": isNullOr(isString),
  "slides.profileWarmedVersion": isNullOr(isString),
  "slides.imageFormat": isOneOf(SLIDE_IMAGE_FORMATS),
  "slides.cacheMaxMb": isNumberIn(1, 1_000_000),
  "slides.maxRenderWidth": isNumberIn(320, 16_384),
  "slides.preemptBackground": isBoolean,
  "library.linkedFolders": isRecordOfKinds(isStringArray),
  "library.activeView": isRecordOfKinds(isString),
  "library.sort": isRecordOfKinds(isOneOf(MEDIA_SORT_ORDERS)),
};

export function isSettingsKey(key: string): key is keyof SettingsMap {
  return key in SETTINGS_VALIDATORS;
}
