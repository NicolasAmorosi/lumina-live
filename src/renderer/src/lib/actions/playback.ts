import { useServiceStore } from "@renderer/stores/service.store";
import { buildCumulativeMs, useProjectionStore } from "@renderer/stores/projection.store";
import { useDeckStore } from "@renderer/stores/deck.store";
import { notifyManualNavigation } from "@renderer/effects/deck-autoplay";
import { api } from "@renderer/lib/api";
import type { DeckDTO } from "@shared/types/deck";
import type { LiveDeck } from "@renderer/stores/projection.store";
import type { OverlayState } from "@shared/types/projection";

let videoEpoch = 0;

function toLiveDeck(deck: DeckDTO): LiveDeck {
  return {
    assetId: deck.assetId,
    deckId: deck.deckId,
    slides: deck.slides,
    soundtrack: deck.soundtrack,
    cumulativeMs: buildCumulativeMs(deck.slides),
    autoAdvance: deck.autoAdvance,
  };
}

/**
 * Presents the currently selected playlist item — the single implementation
 * behind PreviewPanel's "En vivo" button and the Enter shortcut, so both stay
 * in sync by construction.
 *
 * For a deck this is also the ONLY place that loads one for projection (the
 * preview panel merely previews). Note the ordering: the deck is fully ready
 * BEFORE `base` changes, so pressing EN VIVO on a not-yet-converted file leaves
 * whatever is currently on the projector untouched instead of cutting to black
 * for the length of a conversion.
 */
export async function presentSelected(): Promise<void> {
  const { items, selectedIndex, setActive } = useServiceStore.getState();
  if (selectedIndex === null) return;
  const item = items[selectedIndex];
  if (!item) return;

  const { setBase } = useProjectionStore.getState();

  if (item.kind === "media") {
    const asset = await api.library.get(item.mediaAssetId);
    if (!asset) return;
    setActive(selectedIndex);
    if (asset.kind === "video") {
      videoEpoch += 1;
      setBase({ kind: "video", assetId: asset.id, epoch: videoEpoch });
    } else {
      setBase({ kind: "image", assetId: asset.id });
    }
    void api.projection.setSoundtrack(null);
    return;
  }

  if (item.kind === "ppt") {
    const deck = await useDeckStore.getState().ensure(item.mediaAssetId);
    if (!deck || deck.status !== "ready" || deck.slides.length === 0) return;

    const store = useProjectionStore.getState();
    setActive(selectedIndex);
    store.setLiveDeck(toLiveDeck(deck));
    store.setBase({ kind: "deck", assetId: deck.assetId, slideIndex: 1 });

    const epoch = useProjectionStore.getState().soundtrackEpoch;
    void api.projection.setSoundtrack(
      deck.soundtrack ? { url: deck.soundtrack.url, epoch } : null,
    );

    // A deck that carries its own timings starts playing on its own, the way
    // PowerPoint did — that IS the "PPTs that pass by themselves" behaviour.
    if (deck.autoAdvance) store.setAutoplay("playing");
    return;
  }

  setActive(selectedIndex);
  void api.projection.setSoundtrack(null);
  if (item.kind === "bible") {
    setBase({ kind: "bible", text: item.text, reference: item.reference });
  } else {
    setBase({ kind: "text", body: item.body });
  }
}

/** Synchronous: the slide cursor lives in the store and flows out through
 *  `selectOutput`, so there is no IPC round-trip to wait on any more. */
export function advanceSlide(direction: 1 | -1): void {
  const { base, liveDeck, setSlideIndex } = useProjectionStore.getState();
  if (base?.kind !== "deck" || !liveDeck) return;
  const next = base.slideIndex + direction;
  if (next < 1 || next > liveDeck.slides.length) return;
  setSlideIndex(next);
  notifyManualNavigation();
}

export function gotoSlide(index: number): void {
  const { base, liveDeck, setSlideIndex } = useProjectionStore.getState();
  if (base?.kind !== "deck" || !liveDeck) return;
  setSlideIndex(index);
  notifyManualNavigation();
}

/** Toggles NEGRO/LOGO — shared by the footer buttons (App.tsx) and the B/L
 *  shortcuts so there's one definition of "toggle" (press again to clear).
 *  A deck's soundtrack deliberately keeps playing underneath. */
export function toggleOverlay(kind: Extract<OverlayState, "black" | "logo">): void {
  const { overlay, setOverlay } = useProjectionStore.getState();
  setOverlay(overlay === kind ? "none" : kind);
}
