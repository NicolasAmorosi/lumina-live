import type { AssetKind } from "../constants";

export type MediaAsset = {
  id: number;
  kind: AssetKind;
  name: string;
  ext: string;
  path: string;
  sizeBytes: number | null;
  /** Last-modified time of the file on disk. Together with `sizeBytes` this is
   *  the identity of the asset's *bytes*, which is what a thumbnail's
   *  cache-buster is keyed on (`assetThumbVersion`) — `updatedAt` is a
   *  property of the row, not of the file, and is wrong for that job. */
  mtimeMs: number | null;
  durationMs: number | null;
  linkedAudioPath: string | null;
  inLibrary: boolean;
  missingSince: number | null;
  createdAt: number;
  updatedAt: number;
};

/** One saved program that still references an asset — surfaced to the
 *  operator when a delete is blocked, so they can see what would break. */
export type MediaAssetUsage = {
  programId: number;
  programName: string;
  itemCount: number;
};

/** Progress of a chunked `library:add`/`library:listFolder` import, pushed
 *  only for batches large enough that the UI needs it (`library-import.ts`).
 *  `status: "done"` is the authoritative end-of-import signal — the renderer
 *  clears its progress bar on this, never on `library-changed` (a `list*`
 *  read can legitimately re-fire that event for unrelated reasons, and used
 *  to be the only thing importPaths() emitted at all). */
export type ImportProgress = {
  kind: AssetKind;
  done: number;
  total: number;
  status: "running" | "done";
};

/**
 * How a resource tab's grid is ordered.
 *
 * Shared vocabulary rather than a renderer-only string: the choice is
 * persisted per asset kind in `settings["library.sort"]`, and main validates
 * what the renderer writes there (`SETTINGS_VALIDATORS`) against this exact
 * list. `date` is the file's own `mtimeMs`, falling back to the row's
 * `createdAt` for an asset that was never stat'd.
 */
export const MEDIA_SORT_ORDERS = [
  "name-asc",
  "name-desc",
  "date-desc",
  "date-asc",
  "size-desc",
  "size-asc",
] as const;
export type MediaSortOrder = (typeof MEDIA_SORT_ORDERS)[number];

/**
 * A video or audio asset that cannot be played YET — main is converting it to
 * a format Chromium decodes (`main/media/conversion-service.ts`). An asset with
 * no state plays as it is: natively, or through a copy that is already done.
 * `worship://asset/<id>` serves whichever of the two is playable, so nothing
 * in the renderer ever picks between them.
 */
export type MediaConversionState =
  | { status: "queued" }
  /** `progress` is 0..1, or null while ffmpeg has not reported any yet. */
  | { status: "converting"; progress: number | null }
  | { status: "failed"; errorCode: MediaConversionError };

export type MediaConversionError =
  /** ffmpeg could not read or write it: a damaged file, or a full disk. */
  | "CONVERSION_FAILED"
  | "SOURCE_MISSING"
  /** The bundled FFmpeg is missing — a broken install, never a user error. */
  | "FFMPEG_MISSING";

/** `state: null` means "playable now": the conversion finished, or the asset
 *  turned out not to need one. `version` names the playable copy when there is
 *  one — the token a url must carry to be served it (`playableAssetUrl`);
 *  `null` means the original plays as it is. */
export type MediaConversionUpdate = {
  assetId: number;
  state: MediaConversionState | null;
  version: string | null;
};

/** What only Chromium itself can say about this machine, reported by the
 *  control window at startup: HEVC decoding depends on the GPU. */
export type DecoderSupport = { hevc: boolean; hevcMain10: boolean };
