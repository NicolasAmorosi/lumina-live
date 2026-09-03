import type { DragEvent } from "react";
import { ASSET_EXTENSIONS, ASSET_KINDS, type AssetKind } from "@shared/constants";

/** Custom MIME types for the two things draggable inside the app: a library
 *  asset (dropped anywhere to add it) and a playlist row (dropped on another
 *  row to reorder). Kept distinct so a single `onDrop` can tell them apart. */
export const MEDIA_ASSET_MIME = "application/x-worship-media-asset";
export const PLAYLIST_INDEX_MIME = "application/x-worship-playlist-index";

export type DraggedAsset = { assetId: number; kind: AssetKind };

export function setMediaAssetDrag(e: DragEvent, payload: DraggedAsset): void {
  e.dataTransfer.effectAllowed = "copy";
  e.dataTransfer.setData(MEDIA_ASSET_MIME, JSON.stringify(payload));
}

export function readMediaAssetDrag(e: DragEvent): DraggedAsset | null {
  const raw = e.dataTransfer.getData(MEDIA_ASSET_MIME);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as DraggedAsset;
  } catch {
    return null;
  }
}

function classifyExt(ext: string): AssetKind | null {
  const lower = ext.toLowerCase();
  return ASSET_KINDS.find((kind) => ASSET_EXTENSIONS[kind].includes(lower)) ?? null;
}

/** Resolves OS files dropped from Finder/Explorer to {path, kind}, skipping
 *  extensions we don't recognize — mirrors the legacy `setupDragDrop` filter. */
export function readOsFilesDrag(e: DragEvent): { path: string; kind: AssetKind }[] {
  const out: { path: string; kind: AssetKind }[] = [];
  for (const file of Array.from(e.dataTransfer.files)) {
    const path = window.worship.getPathForFile(file);
    const ext = path.slice(path.lastIndexOf(".") + 1);
    const kind = classifyExt(ext);
    if (kind) out.push({ path, kind });
  }
  return out;
}
