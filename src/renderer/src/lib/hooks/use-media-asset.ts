import { useEffect, useReducer } from "react";
import type { MediaAsset } from "@shared/types/media";
import { api } from "@renderer/lib/api";

const cache = new Map<number, MediaAsset | null>();

/** Small id -> MediaAsset cache so playlist rows (which only store a
 *  mediaAssetId) can render a name/badge without threading the whole library
 *  list through every consumer.
 *
 * The return value is always read straight from `cache` during render —
 * never from a `useState` set only inside the effect. That state would lag
 * one render behind an id change (React doesn't run effects until after the
 * render commits), so a consumer switching from asset A to asset B would
 * momentarily see A's object under B's id. `usePreviewContent` builds a
 * `{kind:"deck", assetId}` straight from this return value, so that stale
 * tick was enough to fire a real `ensure()` conversion request for the WRONG
 * asset (e.g. a live video, mistaken for a still-loading PPT). */
export function useMediaAsset(id: number | null): MediaAsset | null {
  const [, forceRerender] = useReducer((c: number) => c + 1, 0);

  useEffect(() => {
    if (id === null || cache.has(id)) return;
    let cancelled = false;
    void api.library.get(id).then((result) => {
      cache.set(id, result);
      if (!cancelled) forceRerender();
    });
    return () => {
      cancelled = true;
    };
  }, [id]);

  return id !== null ? (cache.get(id) ?? null) : null;
}
