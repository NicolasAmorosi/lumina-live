import { useEffect, useMemo, useState } from "react";
import { useT } from "@renderer/lib/i18n/i18n-provider";
import { Button, EmptyState, Icon } from "@renderer/components/ui";
import { PanelBody } from "@renderer/components/shared/panel";
import { useServiceStore } from "@renderer/stores/service.store";
import { useProjectionStore } from "@renderer/stores/projection.store";
import { useMediaAsset } from "@renderer/lib/hooks/use-media-asset";
import { advancePptSlide, presentSelected } from "@renderer/lib/actions/playback";
import { api } from "@renderer/lib/api";
import { assetUrl } from "@shared/urls";
import type { ServiceItemDTO } from "@shared/types/service";

export function PreviewPanel() {
  const t = useT();
  const { items, selectedIndex } = useServiceStore();
  const base = useProjectionStore((s) => s.base);
  const pptSlide = useProjectionStore((s) => s.pptSlide);
  const pptTotal = useProjectionStore((s) => s.pptTotal);
  const setPptSlide = useProjectionStore((s) => s.setPptSlide);
  const setPptTotal = useProjectionStore((s) => s.setPptTotal);
  const item: ServiceItemDTO | undefined = selectedIndex !== null ? items[selectedIndex] : undefined;

  const isMedia = item?.kind === "media" || item?.kind === "ppt";
  const asset = useMediaAsset(isMedia ? (item as { mediaAssetId: number }).mediaAssetId : null);

  const [pptSlideUrls, setPptSlideUrls] = useState<string[]>([]);

  // Reacts to what's actually presenting (`base`), not just to browsing the
  // list (`selectedIndex`) — this is what lets the ←/→ shortcut drive the
  // same open PPT session regardless of which component triggered it.
  useEffect(() => {
    if (base?.kind !== "ppt") {
      setPptSlide(1);
      setPptTotal(0);
      setPptSlideUrls([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      const result = await api.ppt.open(base.assetId);
      if (cancelled) return;
      setPptTotal(result.totalSlides);
      setPptSlide(1);
      const exported = await api.ppt.exportSlides(base.assetId);
      if (!cancelled) setPptSlideUrls(exported.urls);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- base.assetId is the only relevant dependency; setPptSlide/setPptTotal are stable store setters.
  }, [base?.kind === "ppt" ? base.assetId : null]);

  const mediaUrl = asset ? assetUrl(asset.id) : null;
  const pptNext = () => advancePptSlide(1);
  const pptPrev = () => advancePptSlide(-1);

  const body = useMemo(() => {
    if (!item) {
      return <EmptyState description={t("preview.placeholderHint")} icon="layers" title={t("preview.placeholder")} />;
    }
    if (item.kind === "media" && asset) {
      if (asset.kind === "video") return <video className="max-h-full max-w-full" controls src={mediaUrl ?? undefined} />;
      if (asset.kind === "image") return <img alt={asset.name} className="max-h-full max-w-full object-contain" src={mediaUrl ?? undefined} />;
      return <p className="text-center text-sm">{asset.name}</p>;
    }
    if (item.kind === "ppt" && asset) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-2">
          <Icon className="size-8 text-badge-ppt" name="ppt" />
          <p className="text-sm font-medium">{item.title ?? asset.name}</p>
          {pptTotal > 0 ? <p className="text-xs text-subtle">Diapositiva {pptSlide} / {pptTotal}</p> : null}
        </div>
      );
    }
    if (item.kind === "bible") {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
          <p className="text-lg">{item.text}</p>
          <p className="text-sm text-subtle">{item.reference}</p>
        </div>
      );
    }
    return <p className="p-6 text-center text-sm">{(item as { body: string }).body}</p>;
  }, [item, asset, mediaUrl, pptSlide, pptTotal, t]);

  return (
    <>
      <PanelBody className="flex items-center justify-center bg-background/40 p-4">{body}</PanelBody>
      {item?.kind === "ppt" ? (
        <div className="flex shrink-0 items-center justify-center gap-2 border-t border-border p-2">
          <Button onClick={() => void pptPrev()} size="sm">
            <Icon name="prev" /> {t("bible.previous")}
          </Button>
          <span className="text-xs text-subtle">Diapositiva {pptSlide} / {pptTotal || "?"}</span>
          <Button onClick={() => void pptNext()} size="sm">
            {t("bible.next")} <Icon name="next" />
          </Button>
        </div>
      ) : null}
      {pptSlideUrls.length > 0 ? (
        <div className="flex shrink-0 gap-1 overflow-x-auto border-t border-border p-2">
          {pptSlideUrls.map((url, index) => (
            <button
              className="shrink-0 overflow-hidden rounded border border-border"
              key={url}
              onClick={() => void api.ppt.goto(index + 1).then(() => setPptSlide(index + 1))}
              type="button"
            >
              <img alt={`Slide ${index + 1}`} className="h-12 w-auto" src={url} />
            </button>
          ))}
        </div>
      ) : null}
      <div className="flex shrink-0 justify-center border-t border-border p-2">
        <Button className="w-full" onClick={() => void presentSelected()} size="lg" variant="live">
          <Icon name="play" /> {t("footer.present")}
        </Button>
      </div>
    </>
  );
}
