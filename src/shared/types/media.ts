import type { AssetKind } from "../constants";

export type MediaAsset = {
  id: number;
  kind: AssetKind;
  name: string;
  ext: string;
  path: string;
  sizeBytes: number | null;
  durationMs: number | null;
  linkedAudioPath: string | null;
  inLibrary: boolean;
  missingSince: number | null;
  createdAt: number;
  updatedAt: number;
};

/** One saved service that still references an asset — surfaced to the
 *  operator when a delete is blocked, so they can see what would break. */
export type MediaAssetUsage = {
  serviceId: number;
  serviceName: string;
  serviceDate: number | null;
  itemCount: number;
};

export type FileProbe = {
  path: string;
  name: string;
  ext: string;
  dir: string;
  hasAudio: boolean;
  audioPath: string | null;
};
