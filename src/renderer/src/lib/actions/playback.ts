import { useProgramStore } from "@renderer/stores/program.store";
import { buildCumulativeMs, useProjectionStore } from "@renderer/stores/projection.store";
import { useDeckStore } from "@renderer/stores/deck.store";
import { useDisplayStore } from "@renderer/stores/display.store";
import { usePreviewStore } from "@renderer/stores/preview.store";
import { useBibleStore } from "@renderer/stores/bible.store";
import { useAudioStore, nextAssetTrack } from "@renderer/stores/audio.store";
import { notifyManualNavigation } from "@renderer/effects/deck-autoplay";
import { projectVerse } from "@renderer/lib/actions/bible";
import { stopPreviewPlayback } from "@renderer/lib/actions/preview-playback";
import { api } from "@renderer/lib/api";
import { assetUrl } from "@shared/urls";
import type { MediaAsset } from "@shared/types/media";
import type { DeckDTO } from "@shared/types/deck";
import type { LiveDeck } from "@renderer/stores/projection.store";
import type { OverlayState } from "@shared/types/projection";
import type { AssetKind } from "@shared/constants";

let videoEpoch = 0;

/** Sends a standalone audio asset live. Unlike every other kind of content,
 *  this never touches `base`/`overlay` — audio is never what's on screen, so
 *  it can coexist with a PPT or a video already live. What gets cut is only
 *  the deck-soundtrack slot; every other audio track already sounding keeps
 *  playing.
 *
 *  One asset, one track: if this asset is already in the live list, EN VIVO
 *  never stacks a second instance of it. Already sounding → no-op, the
 *  existing track plays on untouched. Already there but paused → restarted
 *  in place instead of duplicated. */
function goLiveWithAudioAsset(asset: MediaAsset, startAtSeconds: number): void {
  const audioStore = useAudioStore.getState();
  const existing = audioStore.tracks.find((t) => t.source === "asset" && t.assetId === asset.id);
  if (existing) {
    if (!existing.paused) return;
    audioStore.restartTrack(existing.trackId, startAtSeconds);
    return;
  }

  const { trackId, epoch } = nextAssetTrack(asset.id);
  audioStore.addTrack({
    trackId,
    source: "asset",
    assetId: asset.id,
    label: asset.name,
    url: assetUrl(asset.id),
    epoch,
    paused: false,
    startAtSeconds,
  });
}

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
  const deckStore = useDeckStore.getState();
  const cached = deckStore.byAssetId[assetId];
  let deck: DeckDTO | null;
  if (cached?.status === "ready" && cached.deck && cached.deck.slides.length > 0) {
    // Already known ready in the store — go live with it immediately instead
    // of waiting on an `ensure()` round-trip. For an already-prewarmed deck
    // that round-trip is a pure cache hit on main's side anyway (same DTO,
    // a beat later); waiting on it is exactly what made EN VIVO on a
    // prepared deck feel slow. Still revalidate in the background (a
    // relocate, a source file that changed on disk) so a real change is
    // caught on the next go-live rather than never.
    deck = cached.deck;
    void deckStore.ensure(assetId);
  } else {
    deck = await deckStore.ensure(assetId);
  }
  if (!deck || deck.status !== "ready" || deck.slides.length === 0) return false;

  const store = useProjectionStore.getState();
  // Begins the new scene right here, at the commit — not before the `await`
  // above — so a not-yet-converted deck (which returns `false` before this
  // point) never burns an epoch on a projector that ends up unchanged.
  store.beginScene();
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
  // `label` is a placeholder: the media panel derives the deck's own display
  // label from the live heading (title/asset name), which can change without
  // this track being re-created.
  useAudioStore
    .getState()
    .setDeckTrack(
      deck.soundtrack
        ? { url: deck.soundtrack.url, epoch, paused: false, startAtSeconds: 0, label: "" }
        : null,
    );

  // A deck that carries its own timings starts playing on its own, the way
  // PowerPoint did — that IS the "PPTs that pass by themselves" behaviour.
  if (deck.autoAdvance) store.setAutoplay("playing");
  return true;
}

type MediaLiveResult = "base" | "audio" | "failed";

/**
 * Video and image replace `base` like everything else. Audio never does —
 * it is sound, not a picture, so it is added as one more live audio track
 * instead (see `goLiveWithAudioAsset`) and the projector keeps showing
 * whatever it already was.
 */
async function goLiveWithMediaAsset(assetId: number, startAtSeconds: number): Promise<MediaLiveResult> {
  const asset = await api.library.get(assetId);
  if (!asset) return "failed";

  if (asset.kind === "audio") {
    goLiveWithAudioAsset(asset, startAtSeconds);
    return "audio";
  }

  const { beginScene, setBase, setOverlay } = useProjectionStore.getState();
  if (asset.kind === "video") {
    beginScene();
    videoEpoch += 1;
    setBase({ kind: "video", assetId: asset.id, epoch: videoEpoch, startAtSeconds });
  } else if (asset.kind === "image") {
    beginScene();
    setBase({ kind: "image", assetId: asset.id });
  } else {
    return "failed";
  }
  setOverlay("none");
  // Whatever this replaces on the projector, its deck (if any) is no longer
  // showing — its music stops with it. Standalone audio tracks are untouched.
  useAudioStore.getState().setDeckTrack(null);
  return "base";
}

async function goLiveWithScheduleItem(index: number, startSlideIndex: number, startAtSeconds: number): Promise<void> {
  const { items, setActive } = useProgramStore.getState();
  const item = items[index];
  if (!item) return;

  switch (item.kind) {
    case "ppt": {
      if (await goLiveWithDeck(item.mediaAssetId, startSlideIndex)) setActive(index);
      return;
    }
    case "media": {
      // Audio never claims the on-air rail — that rail means "this is what's
      // on the projector", and audio never is. Its own "sounding" indicator
      // (schedule-row.tsx) is driven by the audio store instead.
      const result = await goLiveWithMediaAsset(item.mediaAssetId, startAtSeconds);
      if (result === "base") setActive(index);
      return;
    }
    case "bible": {
      setActive(index);
      useAudioStore.getState().setDeckTrack(null);
      // Not driven by projectVerse() — this reference doesn't necessarily
      // belong to the chapter currently loaded in the Bible browser, so any
      // stale live-verse cursor from earlier browsing must not linger.
      useBibleStore.getState().setCurrentVerseIndex(null);
      useProjectionStore.getState().beginScene();
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
      useAudioStore.getState().setDeckTrack(null);
      useProjectionStore.getState().beginScene();
      useProjectionStore.getState().setBase({ kind: "text", body: item.body });
      useProjectionStore.getState().setOverlay("none");
    }
  }
}

async function goLiveWithAsset(
  assetId: number,
  assetKind: AssetKind,
  startSlideIndex: number,
  startAtSeconds: number,
): Promise<void> {
  const result =
    assetKind === "ppt"
      ? (await goLiveWithDeck(assetId, startSlideIndex))
        ? "base"
        : "failed"
      : await goLiveWithMediaAsset(assetId, startAtSeconds);
  // Live content that isn't in the schedule: no row can claim the on-air rail.
  if (result === "base") useProgramStore.getState().setActive(null);
}

/**
 * Stage two: send whatever is in the preview pane to the projector. The single
 * implementation behind the EN VIVO button, the Enter shortcut and
 * double-clicking a row, a tile or a verse — so all four can never diverge.
 */
export async function goLive(): Promise<void> {
  const { slideIndex, positionSeconds, target } = usePreviewStore.getState();
  if (!target) return;

  // `beginScene()` is NOT called here at the top: `goLiveWithDeck`/
  // `goLiveWithMediaAsset` below can fail (asset missing, deck not yet
  // converted) or resolve to an audio-only track that never touches `base` —
  // none of those actually change what the projector shows. Each branch
  // calls `beginScene()` itself, right at its own commit point, so an epoch
  // is only ever spent on a push that really changes the picture.

  // Whatever the preview video was doing, it stops the moment its file goes
  // live — the projector picks up from `positionSeconds` below, so there is
  // never more than one active decode of the same file at once.
  stopPreviewPlayback();

  // If nothing is projected yet, the very act of going live is what turns the
  // projector on — the app itself never opens it on launch any more.
  await useDisplayStore.getState().openIfNeeded();

  switch (target.kind) {
    case "scheduleItem":
      await goLiveWithScheduleItem(target.index, slideIndex, positionSeconds);
      return;
    case "asset":
      await goLiveWithAsset(target.assetId, target.assetKind, slideIndex, positionSeconds);
      return;
    case "verse":
      useProgramStore.getState().setActive(null);
      useAudioStore.getState().setDeckTrack(null);
      useProjectionStore.getState().beginScene();
      projectVerse(target.verseIndex);
      useProjectionStore.getState().setOverlay("none");
  }
}

/** Takes everything off the projector — the LIMPIAR button. The projection
 *  window is never hidden, so "nothing live" is just the logo output. Cuts
 *  every audio track too, not just the deck's — LIMPIAR means silence. */
export function clearLive(): void {
  const store = useProjectionStore.getState();
  store.beginScene();
  store.setOverlay("none");
  store.setBase(null);
  store.setLiveDeck(null);
  useProgramStore.getState().setActive(null);
  useBibleStore.getState().setCurrentVerseIndex(null);
  useAudioStore.getState().clear();
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

/** Clears just what's on the projector right now — a live video, PPT deck or
 *  image — back to nothing, via each row's own delete button. Unlike
 *  `clearLive` (the LIMPIAR button), it never touches independent audio
 *  tracks: deleting the video shouldn't silence a soundtrack playing
 *  alongside it.
 *
 *  NEGRO/LOGO are unaffected on purpose: `selectOutputWithoutUnderlay` shows
 *  black/the logo regardless of `base` while either is up, so deleting
 *  what's underneath is invisible to the congregation — the operator stays
 *  exactly where they were, nothing to fade. Only `overlay === "none"` (the
 *  live content itself was on screen) actually loses something visible, so
 *  only that case begins a new scene and forces the overlay to LOGO — with
 *  no base left, NEGRO/LOGO/VIVO would otherwise keep showing VIVO selected
 *  while the projector is actually rendering the logo fallback. */
export function clearBaseContent(): void {
  const store = useProjectionStore.getState();
  const wasLive = store.overlay === "none";
  if (wasLive) store.beginScene();
  store.setBase(null);
  store.setLiveDeck(null);
  if (wasLive) store.setOverlay("logo");
  useAudioStore.getState().setDeckTrack(null);
  useProgramStore.getState().setActive(null);
  // Otherwise the Bible browser would keep showing the deleted verse as
  // on-air (bible-browser.tsx reads this independently of `base`) — the same
  // reason clearLive() resets it.
  useBibleStore.getState().setCurrentVerseIndex(null);
}

/** Toggles NEGRO/LOGO — shared by the status-bar buttons and the B/L
 *  shortcuts so there's one definition of "toggle" (press again to clear).
 *  A deck's soundtrack deliberately keeps playing underneath. Also opens the
 *  projection window on demand, the same as `goLive()`. */
export async function toggleOverlay(kind: Extract<OverlayState, "black" | "logo">): Promise<void> {
  await useDisplayStore.getState().openIfNeeded();
  const { beginScene, overlay, setOverlay } = useProjectionStore.getState();
  beginScene();
  setOverlay(overlay === kind ? "none" : kind);
}

/** Shared by the three status-bar buttons (LOGO/NEGRO/EN VIVO) — each always
 *  forces its own state (never "un-toggles" on a second press, unlike B/L's
 *  `toggleOverlay`). Opens the projection window on demand, same as
 *  `goLive()`, and begins a new scene so switching overlays fades like every
 *  other "send something new" action. */
export async function setOverlayDirect(kind: OverlayState): Promise<void> {
  await useDisplayStore.getState().openIfNeeded();
  const store = useProjectionStore.getState();
  // Pressing a button for the state that's already showing must not fade —
  // there is nothing to fade between, and under "fade through black" it would
  // flash the whole scene out and back in for no visible change.
  if (store.overlay === kind) return;
  store.beginScene();
  store.setOverlay(kind);
}
