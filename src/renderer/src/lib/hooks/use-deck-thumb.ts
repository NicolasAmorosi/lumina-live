import { useEffect } from "react";
import { useDeckStore } from "@renderer/stores/deck.store";

/**
 * First-slide thumbnail for a deck, if it's already converted. Uses the
 * cache-only `deck:get` — never `ensure` — so merely rendering a playlist or a
 * library list can't kick off a conversion.
 */
export function useDeckThumb(assetId: number | null): string | null {
  const entry = useDeckStore((s) => (assetId === null ? undefined : s.byAssetId[assetId]));
  const peek = useDeckStore((s) => s.peek);

  useEffect(() => {
    if (assetId === null || entry !== undefined) return;
    void peek(assetId);
  }, [assetId, entry, peek]);

  return entry?.deck?.slides[0]?.thumbUrl ?? null;
}
