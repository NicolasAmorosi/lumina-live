import { useEffect } from "react";
import { useDeckStore, type DeckEntry } from "@renderer/stores/deck.store";
import type { DeckEnvironment } from "@shared/types/deck";

export type DeckState = {
  entry: DeckEntry | undefined;
  environment: DeckEnvironment | null;
  /** Force a re-conversion (retry / stale file). */
  reconvert: () => void;
  locateSoffice: () => void;
  markStale: () => void;
};

/**
 * Loads the deck for `assetId`, converting it on selection so it is warm
 * before anyone hits EN VIVO. The cache-only `peek` first keeps an
 * already-converted deck from re-entering the queue on every click.
 *
 * Extracted from the old DeckPreview so the slide grid and the preview monitor
 * share one loader instead of racing two.
 */
export function useDeck(assetId: number | null): DeckState {
  const entry = useDeckStore((s) => (assetId === null ? undefined : s.byAssetId[assetId]));
  const environment = useDeckStore((s) => s.environment);
  const ensure = useDeckStore((s) => s.ensure);
  const peek = useDeckStore((s) => s.peek);
  const locateSoffice = useDeckStore((s) => s.locateSoffice);
  const markStale = useDeckStore((s) => s.markStale);

  useEffect(() => {
    if (assetId === null) return;
    let cancelled = false;
    void (async () => {
      const cached = await peek(assetId);
      if (cancelled || cached) return;
      if (environment && !environment.available) return;
      await ensure(assetId);
    })();
    return () => {
      cancelled = true;
    };
  }, [assetId, ensure, peek, environment]);

  return {
    entry,
    environment,
    reconvert: () => {
      if (assetId !== null) void ensure(assetId, true);
    },
    locateSoffice: () => void locateSoffice(),
    markStale: () => {
      if (assetId !== null) markStale(assetId);
    },
  };
}
