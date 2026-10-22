import { useEffect } from "react";
import { reconvertDeck } from "@renderer/lib/actions/deck";
import { useDeckStore, type DeckEntry } from "@renderer/stores/deck.store";
import type { DeckEnvironment } from "@shared/types/deck";

export type DeckState = {
  entry: DeckEntry | undefined;
  environment: DeckEnvironment | null;
  /** Force a re-conversion (retry / stale file). Refused, with a toast, while
   *  that very deck is on the projector — see `reconvertDeck`. */
  reconvert: () => void;
  markStale: () => void;
  /** Cache-only re-fetch of the DTO — for after a change that never touches
   *  the deck cache, like setting the linked-audio override. */
  refresh: () => void;
};

/**
 * Loads the deck for `assetId`, converting it on selection so it is warm
 * before anyone hits EN VIVO. The cache-only `peek` first keeps an
 * already-converted deck from re-entering the queue on every click.
 *
 * Extracted from the old DeckPreview so the slide grid and the preview monitor
 * share one loader instead of racing two.
 */
/**
 * `requiresSoffice` is the caller's answer to "does converting THIS deck need
 * LibreOffice" (`deckRequiresSoffice`), not a global one. A PDF is rasterized
 * straight from its source, so a machine with no LibreOffice still converts and
 * projects it — gating every deck on one environment flag would refuse it for a
 * dependency it never had. Defaults to `true`, so a caller that doesn't know
 * gets the conservative behaviour this hook always had.
 */
export function useDeck(assetId: number | null, requiresSoffice = true): DeckState {
  const entry = useDeckStore((s) => (assetId === null ? undefined : s.byAssetId[assetId]));
  const environment = useDeckStore((s) => s.environment);
  const ensure = useDeckStore((s) => s.ensure);
  const peek = useDeckStore((s) => s.peek);
  const markStale = useDeckStore((s) => s.markStale);
  const refreshDeck = useDeckStore((s) => s.peek);
  // Asked again whenever this deck's entry DISAPPEARS: the store drops one
  // that turns `ready` with no DTO and nobody awaiting it — a deck the
  // operator cancelled and a background prewarm finished later — and the
  // panel then sat on «Preparando la conversión…» over a ready deck.
  const missing = entry === undefined;

  useEffect(() => {
    if (assetId === null) return;
    let cancelled = false;
    void (async () => {
      const cached = await peek(assetId);
      if (cancelled || cached) return;
      // Cancelled by the operator (`stale` with nothing rendered — the same
      // test `DeckConversionStatus` uses): converting it again is theirs to ask.
      const current = useDeckStore.getState().byAssetId[assetId];
      if (current?.status === "stale" && current.deck === null) return;
      if (requiresSoffice && environment && !environment.available) return;
      await ensure(assetId);
    })();
    return () => {
      cancelled = true;
    };
  }, [assetId, ensure, peek, environment, requiresSoffice, missing]);

  return {
    entry,
    environment,
    reconvert: () => {
      if (assetId !== null) reconvertDeck(assetId);
    },
    markStale: () => {
      if (assetId !== null) markStale(assetId);
    },
    refresh: () => {
      if (assetId !== null) void refreshDeck(assetId);
    },
  };
}
