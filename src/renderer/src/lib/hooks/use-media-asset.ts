import { useEffect, useState } from "react";
import type { MediaAsset } from "@shared/types/media";
import { api } from "@renderer/lib/api";

const cache = new Map<number, MediaAsset | null>();

/** Small id -> MediaAsset cache so playlist rows (which only store a
 *  mediaAssetId) can render a name/badge without threading the whole library
 *  list through every consumer. */
export function useMediaAsset(id: number | null): MediaAsset | null {
  const [asset, setAsset] = useState<MediaAsset | null>(id !== null ? (cache.get(id) ?? null) : null);

  useEffect(() => {
    if (id === null) return;
    if (cache.has(id)) {
      setAsset(cache.get(id) ?? null);
      return;
    }
    let cancelled = false;
    void api.library.get(id).then((result) => {
      cache.set(id, result);
      if (!cancelled) setAsset(result);
    });
    return () => {
      cancelled = true;
    };
  }, [id]);

  return asset;
}
