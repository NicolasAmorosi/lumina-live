import { create } from "zustand";
import { assetUrl } from "@shared/urls";
import type { MediaConversionState, MediaConversionUpdate } from "@shared/types/media";

/**
 * The videos and audios main is still converting into something Chromium can
 * play (`main/media/conversion-service.ts`), mirrored by
 * `effects/conversion-sync.ts`. Only assets that CANNOT play yet are here, so
 * "no entry" is the common case and means "plays".
 */
type ConversionStoreState = {
  byAssetId: Record<number, MediaConversionState>;
  /** The playable copy of each converted asset, by the token main serves it
   *  under (`playableAssetUrl`). Absent = the original plays. */
  versions: Record<number, string>;
  apply: (update: MediaConversionUpdate) => void;
  /** Main's full list, which supersedes every event that arrived before it. */
  reset: (updates: MediaConversionUpdate[]) => void;
};

export const useConversionStore = create<ConversionStoreState>((set) => ({
  byAssetId: {},
  versions: {},
  apply: ({ assetId, state, version }) =>
    set((s) => {
      const { [assetId]: _state, ...otherStates } = s.byAssetId;
      const { [assetId]: _version, ...otherVersions } = s.versions;
      return {
        byAssetId: state ? { ...otherStates, [assetId]: state } : otherStates,
        versions: version ? { ...otherVersions, [assetId]: version } : otherVersions,
      };
    }),
  reset: (updates) =>
    set({
      byAssetId: Object.fromEntries(
        updates.flatMap(({ assetId, state }) => (state ? [[assetId, state] as const] : [])),
      ),
      versions: Object.fromEntries(
        updates.flatMap(({ assetId, version }) => (version ? [[assetId, version] as const] : [])),
      ),
    }),
}));

/** For the hooks and components that only care about one asset. */
export function useConversion(assetId: number | null): MediaConversionState | undefined {
  return useConversionStore((s) => (assetId === null ? undefined : s.byAssetId[assetId]));
}

/**
 * The url a `<video>`/`<audio>` should load for a library asset.
 *
 * Main serves the converted copy behind the same `worship://asset/<id>`, but
 * only to a url carrying its version (`?v=`); the bare url always means the
 * original. Two reasons, both measured on 2026-10-18:
 *
 * - Chromium's media cache reuses a url's data across elements, so a new
 *   `<video>` given the string it had already tried failed again on the AVI
 *   bytes it remembered, with the copy already in place and even with
 *   `Cache-Control: no-store`. The string has to change when the bytes do.
 * - An element that started on the original (a file that looked native and
 *   went live before its probe finished) must keep getting the original's
 *   bytes on its next Range request, not the copy's in the middle of a song.
 *
 * Only for video and audio: an image is never converted.
 */
export function playableAssetUrl(assetId: number): string {
  return withVersion(assetId, useConversionStore.getState().versions[assetId]);
}

/** The same url, for a component that must re-render when it changes. */
export function usePlayableAssetUrl(assetId: number): string;
export function usePlayableAssetUrl(assetId: number | null): string | null;
export function usePlayableAssetUrl(assetId: number | null): string | null {
  const version = useConversionStore((s) => (assetId === null ? undefined : s.versions[assetId]));
  return assetId === null ? null : withVersion(assetId, version);
}

function withVersion(assetId: number, version: string | undefined): string {
  return version === undefined ? assetUrl(assetId) : `${assetUrl(assetId)}?v=${encodeURIComponent(version)}`;
}
