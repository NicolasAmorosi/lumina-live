import { useBibleStore } from "@renderer/stores/bible.store";
import { useDeckStore } from "@renderer/stores/deck.store";
import { usePreviewStore } from "@renderer/stores/preview.store";
import { useServiceStore } from "@renderer/stores/service.store";
import { useMediaAsset } from "@renderer/lib/hooks/use-media-asset";
import { assetUrl } from "@shared/urls";
import type { MediaAsset } from "@shared/types/media";
import type { ProjectionOutput } from "@shared/types/projection";

/**
 * The preview target resolved against the stores — one shape the whole right
 * column and the slide grid can switch on, instead of every panel re-deriving
 * "what am I looking at" from three stores.
 */
export type PreviewContent =
  | { kind: "deck"; assetId: number; title: string }
  | { kind: "media"; asset: MediaAsset }
  | { kind: "bible"; reference: string; text: string; verseIndex: number | null }
  | { kind: "text"; body: string };

export function usePreviewContent(): PreviewContent | null {
  const target = usePreviewStore((s) => s.target);
  const items = useServiceStore((s) => s.items);
  const verses = useBibleStore((s) => s.verses);

  const scheduleItem = target?.kind === "scheduleItem" ? items[target.index] : undefined;
  const scheduleAssetId =
    scheduleItem?.kind === "media" || scheduleItem?.kind === "ppt" ? scheduleItem.mediaAssetId : null;
  // Both lookups are unconditional: hooks can't be called behind a branch, and
  // useMediaAsset(null) is a no-op.
  const scheduleAsset = useMediaAsset(scheduleAssetId);
  const directAsset = useMediaAsset(target?.kind === "asset" ? target.assetId : null);

  if (!target) return null;

  if (target.kind === "verse") {
    const verse = verses[target.verseIndex];
    if (!verse) return null;
    return {
      kind: "bible",
      reference: `${verse.bookName} ${verse.chapter}:${verse.verse}`,
      text: verse.text,
      verseIndex: target.verseIndex,
    };
  }

  if (target.kind === "asset") {
    if (!directAsset) return null;
    return target.assetKind === "ppt"
      ? { kind: "deck", assetId: directAsset.id, title: directAsset.name }
      : { kind: "media", asset: directAsset };
  }

  if (!scheduleItem) return null;
  switch (scheduleItem.kind) {
    case "ppt":
      return scheduleAsset
        ? { kind: "deck", assetId: scheduleAsset.id, title: scheduleItem.title ?? scheduleAsset.name }
        : null;
    case "media":
      return scheduleAsset ? { kind: "media", asset: scheduleAsset } : null;
    case "bible":
      return {
        kind: "bible",
        reference: scheduleItem.reference,
        text: scheduleItem.text,
        verseIndex: null,
      };
    case "text":
      return { kind: "text", body: scheduleItem.body };
  }
}

/**
 * The preview pane's own `ProjectionOutput` — the same value type the projector
 * consumes, so the preview monitor is literally the projection renderer fed a
 * different input. Returns null when there is nothing renderable (an audio-only
 * asset, or a deck still converting).
 */
export function usePreviewOutput(content: PreviewContent | null): ProjectionOutput | null {
  const slideIndex = usePreviewStore((s) => s.slideIndex);
  const deckEntry = useDeckStore((s) => (content?.kind === "deck" ? s.byAssetId[content.assetId] : undefined));

  if (!content) return null;

  switch (content.kind) {
    case "deck": {
      const slides = deckEntry?.deck?.slides ?? [];
      const slide = slides[Math.min(slideIndex, slides.length) - 1];
      if (!slide) return null;
      return {
        kind: "slide",
        deckAssetId: content.assetId,
        url: slide.url,
        index: slide.index,
        total: slides.length,
        // The projector warms neighbours; a monitor has no reason to.
        preload: [],
        videoUnderlay: null,
      };
    }
    case "media": {
      if (content.asset.kind === "image") {
        return { kind: "image", url: assetUrl(content.asset.id), videoUnderlay: null };
      }
      if (content.asset.kind === "video") {
        // Preview never plays anything (mode="monitor" never autoplays) — it
        // shows a frozen first frame. The chosen start point only matters
        // once EN VIVO actually sends this asset live; see `goLive()`.
        const underlay = { url: assetUrl(content.asset.id), epoch: 0, paused: true, startAtSeconds: 0 };
        return { kind: "video", url: underlay.url, epoch: underlay.epoch, videoUnderlay: underlay };
      }
      return null;
    }
    case "bible":
      return { kind: "bible", text: content.text, reference: content.reference, videoUnderlay: null };
    case "text":
      return { kind: "text", body: content.body, videoUnderlay: null };
  }
}
