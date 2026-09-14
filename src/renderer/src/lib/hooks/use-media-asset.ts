import { useEffect, useReducer, useSyncExternalStore } from "react";
import type { MediaAsset } from "@shared/types/media";
import { api } from "@renderer/lib/api";

/** Bounded: a long service browsing a large library would otherwise keep every
 *  asset it ever looked at alive for the rest of the session. Insertion-ordered
 *  like every `Map`, so the first key is the oldest. */
const MAX_CACHED = 500;
const cache = new Map<number, MediaAsset | null>();

/**
 * Bumped whenever an entry is invalidated, and subscribed to by every mounted
 * consumer.
 *
 * Deleting from the map alone was not enough: the fetching effect below only
 * re-runs when `id` changes, so a component already showing asset 7 kept
 * showing the stale copy until it happened to remount. That is exactly the
 * case a relocate creates — the operator repairs a missing file from the very
 * panel that is displaying "no se encuentra el archivo", and the panel has to
 * stop saying it.
 */
let generation = 0;
const listeners = new Set<() => void>();

function subscribeToInvalidations(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

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
  const invalidation = useSyncExternalStore(subscribeToInvalidations, () => generation);

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
    // `invalidation` is a dependency, not an unused value: it is what makes a
    // forgotten id be fetched again by the consumers that are already mounted.
  }, [id, invalidation]);

  return id !== null ? (cache.get(id) ?? null) : null;
}

/** Whatever this cache already knows about an id, for the plain functions
 *  outside React (`effects/*`) that need a file's name for a message. Never
 *  fetches: a toast is not worth a round-trip, and anything that is actually
 *  live has already been resolved by the header and the media panel. */
export function getCachedMediaAsset(id: number | null): MediaAsset | null {
  return id !== null ? (cache.get(id) ?? null) : null;
}

/** Drops an asset from the module-level cache — because it was deleted, so a
 *  stale name/thumb stops rendering for a schedule row that no longer has one,
 *  or because its row changed underneath (a relocate). Every mounted consumer
 *  re-renders and re-fetches; see `generation`. */
export function forgetMediaAsset(id: number): void {
  cache.delete(id);
  invalidate();
}

/**
 * Drops everything, for the events that say "the library changed" without
 * saying which rows — the background missing-file sweep above all.
 *
 * Without this the cache was a second, stale copy of the library that nothing
 * ever refreshed: a file that went missing mid-session stayed cached as
 * present, so the preview of a schedule row kept offering content whose file
 * was gone, and the "no se encuentra el archivo" panel (with its Relocalizar…
 * button) never appeared until the row happened to remount. Refetching is
 * lazy and per-id, so the cost is one `library:get` for each row actually on
 * screen, on an event that fires on an import, a sweep that found a change,
 * or a relocate — not in any loop.
 */
export function forgetAllMediaAssets(): void {
  cache.clear();
  invalidate();
}

function invalidate(): void {
  generation += 1;
  for (const listener of listeners) listener();
}
