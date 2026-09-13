import { useEffect, useReducer } from "react";
import type { MediaAsset } from "@shared/types/media";
import { api } from "@renderer/lib/api";

/** Bounded: a long service browsing a large library would otherwise keep every
 *  asset it ever looked at alive for the rest of the session. Insertion-ordered
 *  like every `Map`, so the first key is the oldest. */
const MAX_CACHED = 500;
const cache = new Map<number, MediaAsset | null>();

function remember(id: number, asset: MediaAsset | null): void {
  while (cache.size >= MAX_CACHED) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }
  cache.set(id, asset);
}

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
    void api.library
      .get(id)
      .then((result) => {
        remember(id, result);
        if (!cancelled) forceRerender();
      })
      .catch((error: unknown) => {
        // Without this the id stayed uncached, so every subsequent render
        // fired the same failing request again — a rejection storm behind a
        // schedule row that simply has no name to show. Remembered as "no
        // asset", which is what the row renders for a missing one anyway;
        // `forgetMediaAsset` is how a later refresh gets a second chance.
        console.error(`[media] could not resolve asset ${id}`, error);
        remember(id, null);
        if (!cancelled) forceRerender();
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  return id !== null ? (cache.get(id) ?? null) : null;
}

/** Whatever this cache already knows about an id, for the plain functions
 *  outside React (`effects/*`) that need a file's name for a message. Never
 *  fetches: a toast is not worth a round-trip, and anything that is actually
 *  live has already been resolved by the header and the media panel. */
export function getCachedMediaAsset(id: number | null): MediaAsset | null {
  return id !== null ? (cache.get(id) ?? null) : null;
}

/** Drops a deleted asset from the module-level cache so a stale name/thumb
 *  doesn't keep rendering for a schedule row that no longer has one. Doesn't
 *  itself trigger a re-render — callers already touch a store, which is what
 *  actually reruns the consumers of `useMediaAsset` above. */
export function forgetMediaAsset(id: number): void {
  cache.delete(id);
}
