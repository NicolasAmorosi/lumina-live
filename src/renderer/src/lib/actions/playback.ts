import { useServiceStore } from "@renderer/stores/service.store";
import { buildCumulativeMs, useProjectionStore } from "@renderer/stores/projection.store";
import { useDeckStore } from "@renderer/stores/deck.store";
import { useDisplayStore } from "@renderer/stores/display.store";
import { usePreviewStore } from "@renderer/stores/preview.store";
import { useBibleStore } from "@renderer/stores/bible.store";
import { notifyManualNavigation } from "@renderer/effects/deck-autoplay";
import { projectVerse } from "@renderer/lib/actions/bible";
import { api } from "@renderer/lib/api";
import type { DeckDTO } from "@shared/types/deck";
import type { LiveDeck } from "@renderer/stores/projection.store";
import type { OverlayState } from "@shared/types/projection";
import type { AssetKind } from "@shared/constants";

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
 * Note the ordering in here: the deck is fully ready BEFORE `base` changes, so
 * hitting EN VIVO on a not-yet-converted file leaves whatever is currently on
 * the projector untouched instead of cutting to black for the length of a
 * conversion.
 */
async function goLiveWithDeck(assetId: number, startSlideIndex: number): Promise<boolean> {
  const deck = await useDeckStore.getState().ensure(assetId);
  if (!deck || deck.status !== "ready" || deck.slides.length === 0) return false;

  const store = useProjectionStore.getState();
  store.setLiveDeck(toLiveDeck(deck));
  store.setBase({
    kind: "deck",
    assetId: deck.assetId,
    slideIndex: Math.min(Math.max(1, startSlideIndex), deck.slides.length),
  });
  // Going live always cuts straight from NEGRO/LOGO to the new content — the
  // operator never has to remember to press EN VIVO/LOGO twice.
  store.setOverlay("none");

  const epoch = useProjectionStore.getState().soundtrackEpoch;
  void api.projection.setSoundtrack(deck.soundtrack ? { url: deck.soundtrack.url, epoch } : null);

  // A deck that carries its own timings starts playing on its own, the way
  // PowerPoint did — that IS the "PPTs that pass by themselves" behaviour.
  if (deck.autoAdvance) store.setAutoplay("playing");
  return true;
}

async function goLiveWithMediaAsset(assetId: number): Promise<boolean> {
  const asset = await api.library.get(assetId);
  if (!asset) return false;
  const { setBase, setOverlay } = useProjectionStore.getState();
  if (asset.kind === "video") {
    videoEpoch += 1;
    setBase({ kind: "video", assetId: asset.id, epoch: videoEpoch });
  } else if (asset.kind === "image") {
    setBase({ kind: "image", assetId: asset.id });
  } else {
    return false;
  }
  setOverlay("none");
  void api.projection.setSoundtrack(null);
  return true;
}

async function goLiveWithScheduleItem(index: number, startSlideIndex: number): Promise<void> {
  const { items, setActive } = useServiceStore.getState();
  const item = items[index];
  if (!item) return;

  switch (item.kind) {
    case "ppt": {
      if (await goLiveWithDeck(item.mediaAssetId, startSlideIndex)) setActive(index);
      return;
    }
    case "media": {
      if (await goLiveWithMediaAsset(item.mediaAssetId)) setActive(index);
      return;
    }
    case "bible": {
      setActive(index);
      void api.projection.setSoundtrack(null);
      // Not driven by projectVerse() — this reference doesn't necessarily
      // belong to the chapter currently loaded in the Bible browser, so any
      // stale live-verse cursor from earlier browsing must not linger.
      useBibleStore.getState().setCurrentVerseIndex(null);
      useProjectionStore.getState().setBase({
        kind: "bible",
        text: item.text,
        reference: item.reference,
      });
      useProjectionStore.getState().setOverlay("none");
      return;
    }
    case "text": {
      setActive(index);
      void api.projection.setSoundtrack(null);
      useProjectionStore.getState().setBase({ kind: "text", body: item.body });
      useProjectionStore.getState().setOverlay("none");
    }
  }
}

async function goLiveWithAsset(assetId: number, assetKind: AssetKind, startSlideIndex: number): Promise<void> {
  const ok =
    assetKind === "ppt"
      ? await goLiveWithDeck(assetId, startSlideIndex)
      : await goLiveWithMediaAsset(assetId);
  // Live content that isn't in the schedule: no row can claim the on-air rail.
  if (ok) useServiceStore.getState().setActive(null);
}

/**
 * Stage two: send whatever is in the preview pane to the projector. The single
 * implementation behind the EN VIVO button, the Enter shortcut and
 * double-clicking a row, a tile or a verse — so all four can never diverge.
 */
export async function goLive(): Promise<void> {
  const { slideIndex, target } = usePreviewStore.getState();
  if (!target) return;

  // If nothing is projected yet, the very act of going live is what turns the
  // projector on — the app itself never opens it on launch any more.
  await useDisplayStore.getState().openIfNeeded();

  switch (target.kind) {
    case "scheduleItem":
      await goLiveWithScheduleItem(target.index, slideIndex);
      return;
    case "asset":
      await goLiveWithAsset(target.assetId, target.assetKind, slideIndex);
      return;
    case "verse":
      useServiceStore.getState().setActive(null);
      void api.projection.setSoundtrack(null);
      projectVerse(target.verseIndex);
      useProjectionStore.getState().setOverlay("none");
  }
}

/** Takes everything off the projector — the LIMPIAR button. The projection
 *  window is never hidden, so "nothing live" is just the logo output. */
export function clearLive(): void {
  const store = useProjectionStore.getState();
  store.setOverlay("none");
  store.setBase(null);
  store.setLiveDeck(null);
  useServiceStore.getState().setActive(null);
  useBibleStore.getState().setCurrentVerseIndex(null);
  void api.projection.setSoundtrack(null);
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

/** Toggles NEGRO/LOGO — shared by the status-bar buttons and the B/L
 *  shortcuts so there's one definition of "toggle" (press again to clear).
 *  A deck's soundtrack deliberately keeps playing underneath. Also opens the
 *  projection window on demand, the same as `goLive()`. */
export async function toggleOverlay(kind: Extract<OverlayState, "black" | "logo">): Promise<void> {
  await useDisplayStore.getState().openIfNeeded();
  const { overlay, setOverlay } = useProjectionStore.getState();
  setOverlay(overlay === kind ? "none" : kind);
}
