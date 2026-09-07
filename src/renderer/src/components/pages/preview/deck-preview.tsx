import { useEffect } from "react";
import { useT } from "@renderer/lib/i18n/i18n-provider";
import { Badge, Button, Callout, Icon, ProgressBar, Skeleton } from "@renderer/components/ui";
import { useDeckStore } from "@renderer/stores/deck.store";
import { useProjectionStore } from "@renderer/stores/projection.store";
import { gotoSlide, presentSelected } from "@renderer/lib/actions/playback";
import { SlideStrip } from "./slide-strip";
import { DeckTransport } from "./deck-transport";

type DeckPreviewProps = { assetId: number; title: string };

/**
 * Everything about the SELECTED deck. Deliberately does not touch
 * `projection.store`: selecting an item previews it, presenting it is
 * `presentSelected()`'s job. Conflating the two is what made the old panel's
 * effect drive projection as a side effect of browsing the playlist.
 */
export function DeckPreview({ assetId, title }: DeckPreviewProps) {
  const t = useT();
  const entry = useDeckStore((s) => s.byAssetId[assetId]);
  const environment = useDeckStore((s) => s.environment);
  const ensure = useDeckStore((s) => s.ensure);
  const peek = useDeckStore((s) => s.peek);
  const locateSoffice = useDeckStore((s) => s.locateSoffice);
  const markStale = useDeckStore((s) => s.markStale);

  const base = useProjectionStore((s) => s.base);
  const liveDeck = useProjectionStore((s) => s.liveDeck);
  const isLive = base?.kind === "deck" && base.assetId === assetId;

  // Convert on selection so a deck is warm before anyone hits EN VIVO. The
  // cache-only peek first keeps an already-converted deck from re-entering the
  // queue on every click.
  useEffect(() => {
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

  if (environment && !environment.available) {
    return (
      <Callout tone="warning">
        <p className="font-medium">{t("deck.noLibreOffice.title")}</p>
        <p className="mt-1 text-xs text-muted-foreground">{t("deck.noLibreOffice.body")}</p>
        <Button className="mt-2" onClick={() => void locateSoffice()} size="sm">
          {t("deck.noLibreOffice.locate")}
        </Button>
      </Callout>
    );
  }

  if (!entry || entry.status === "converting") {
    const done = entry?.progress.done ?? 0;
    const total = entry?.progress.total ?? 0;
    return (
      <div className="flex w-full max-w-md flex-col gap-2">
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
        {entry.error ? (
          <p className="mt-1 text-xs text-muted-foreground">{entry.error}</p>
        ) : null}
        <Button className="mt-2" onClick={() => void ensure(assetId, true)} size="sm">
          {t("deck.retry")}
        </Button>
      </Callout>
    );
  }

  const deck = entry.deck;
  if (!deck || deck.slides.length === 0) {
    return <p className="text-center text-sm text-subtle">{t("deck.noSlides")}</p>;
  }

  const isStale = entry.status === "stale";
  // Show the live slide when this deck is on screen, otherwise slide 1.
  const shownIndex = isLive && base.kind === "deck" ? base.slideIndex : 1;
  const shown = deck.slides[shownIndex - 1] ?? deck.slides[0]!;

  return (
    <div className="flex h-full w-full flex-col gap-2">
      {isStale ? (
        <Callout tone="warning">
          <p>{t("deck.stale")}</p>
          <Button className="mt-2" onClick={() => void ensure(assetId, true)} size="sm">
            {t("deck.reconvert")}
          </Button>
        </Callout>
      ) : null}

      <div className="flex min-h-0 flex-1 items-center justify-center">
        <img
          alt={t("deck.slideAlt", { index: shown.index })}
          className="max-h-full max-w-full object-contain"
          // The cache dir can be evicted under us; surface it instead of
          // leaving a broken image.
          onError={() => markStale(assetId)}
          src={shown.url}
        />
      </div>

      <div className="flex shrink-0 items-center justify-center gap-2 text-xs text-subtle">
        <Icon className="size-3 text-badge-ppt" name="ppt" />
        <span className="truncate">{title}</span>
        {!isLive ? <Badge variant="neutral">{t("deck.notLive")}</Badge> : null}
      </div>

      <SlideStrip
        currentIndex={isLive ? shownIndex : null}
        onSelect={(index) => {
          if (isLive) {
            gotoSlide(index);
            return;
          }
          // Jumping from a deck that isn't live presents it first, then lands
          // on the slide the operator actually clicked.
          void presentSelected().then(() => gotoSlide(index));
        }}
        slides={deck.slides}
      />

      {isLive && liveDeck ? <DeckTransport /> : null}
    </div>
  );
}
