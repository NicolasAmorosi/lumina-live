import { useT } from "@renderer/lib/i18n/i18n-provider";
import { Button, Callout, ProgressBar, SlideGrid, Skeleton, ThumbTile } from "@renderer/components/ui";
import { useDeck } from "@renderer/lib/hooks/use-deck";
import { useProjectionStore } from "@renderer/stores/projection.store";
import { usePreviewStore } from "@renderer/stores/preview.store";
import { setPreviewSlide } from "@renderer/lib/actions/preview";
import { goLive, gotoSlide } from "@renderer/lib/actions/playback";

/**
 * Every state a deck can be in, in the centre column: missing LibreOffice,
 * converting, failed, stale, and the slide grid itself. This is the only place
 * that triggers a conversion (via useDeck), so browsing the schedule can't
 * queue work twice.
 */
export function DeckSlides({ assetId }: { assetId: number }) {
  const t = useT();
  const { entry, environment, locateSoffice, markStale, reconvert } = useDeck(assetId);
  const base = useProjectionStore((s) => s.base);
  const previewIndex = usePreviewStore((s) => s.slideIndex);

  const isLive = base?.kind === "deck" && base.assetId === assetId;
  const liveIndex = isLive ? base.slideIndex : null;

  if (environment && !environment.available) {
    return (
      <Callout tone="warning">
        <p className="font-medium">{t("deck.noLibreOffice.title")}</p>
        <p className="mt-1 text-xs text-muted-foreground">{t("deck.noLibreOffice.body")}</p>
        <Button className="mt-2" onClick={locateSoffice} size="sm">
          {t("deck.noLibreOffice.locate")}
        </Button>
      </Callout>
    );
  }

  if (!entry || entry.status === "converting") {
    const done = entry?.progress.done ?? 0;
    const total = entry?.progress.total ?? 0;
    return (
      <div className="flex w-full max-w-md flex-col gap-2 self-center">
        <Skeleton className="aspect-video w-full" />
        <ProgressBar value={total > 0 ? done / total : 0} />
        <p className="text-center text-xs text-subtle">
          {total > 0 ? t("deck.converting", { done, total }) : t("deck.preparing")}
        </p>
        <p className="text-center text-xs text-subtle">{t("deck.convertingHint")}</p>
      </div>
    );
  }

  if (entry.status === "failed") {
    return (
      <Callout tone="danger">
        <p className="font-medium">{t("deck.failed")}</p>
        {entry.error ? <p className="mt-1 text-xs text-muted-foreground">{entry.error}</p> : null}
        <Button className="mt-2" onClick={reconvert} size="sm">
          {t("deck.retry")}
        </Button>
      </Callout>
    );
  }

  const slides = entry.deck?.slides ?? [];
  if (slides.length === 0) {
    return <p className="self-center text-sm text-subtle">{t("deck.noSlides")}</p>;
  }

  return (
    <div className="flex min-h-0 flex-col gap-2">
      {entry.status === "stale" ? (
        <Callout tone="warning">
          <p>{t("deck.stale")}</p>
          <Button className="mt-2" onClick={reconvert} size="sm">
            {t("deck.reconvert")}
          </Button>
        </Callout>
      ) : null}
      <SlideGrid variant="fixed-2">
        {slides.map((slide) => (
          <ThumbTile
            index={slide.index}
            key={slide.index}
            live={liveIndex === slide.index}
            onClick={() => setPreviewSlide(slide.index)}
            // The cache dir can be evicted under us; surface it instead of
            // leaving a broken image.
            onImageError={markStale}
            // Already live: jump on the projector. Not live: this deck goes on
            // air starting from the slide that was double-clicked.
            onDoubleClick={() => {
              setPreviewSlide(slide.index);
              if (isLive) gotoSlide(slide.index);
              else void goLive();
            }}
            selected={previewIndex === slide.index}
            src={slide.thumbUrl}
            title={t("deck.slideAlt", { index: slide.index })}
          />
        ))}
      </SlideGrid>
    </div>
  );
}
