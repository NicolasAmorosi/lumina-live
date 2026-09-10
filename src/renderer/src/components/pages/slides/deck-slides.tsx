import { useT } from "@renderer/lib/i18n/i18n-provider";
import {
  Badge,
  Button,
  Callout,
  EmptyState,
  Icon,
  IconButton,
  MediaPanel,
  ProgressBar,
  SlideGrid,
  Skeleton,
  ThumbTile,
  Tooltip,
} from "@renderer/components/ui";
import { PreviewMissingState } from "@renderer/components/shared/preview-missing-state";
import { useDeck } from "@renderer/lib/hooks/use-deck";
import { useProjectionStore } from "@renderer/stores/projection.store";
import { usePreviewStore } from "@renderer/stores/preview.store";
import { clearPreview, setPreviewSlide } from "@renderer/lib/actions/preview";
import { goLive, gotoSlide } from "@renderer/lib/actions/playback";
import { api } from "@renderer/lib/api";
import type { DeckDTO } from "@shared/types/deck";

/**
 * Every state a deck can be in, in the centre column: missing LibreOffice,
 * converting, failed, stale, and the slide grid itself. This is the only place
 * that triggers a conversion (via useDeck), so browsing the schedule can't
 * queue work twice.
 */
function DeckAudioStrip({ assetId, deck }: { assetId: number; deck: DeckDTO }) {
  const t = useT();
  const { refresh } = useDeck(assetId);

  async function assign() {
    const paths = await api.files.pick("audio", false);
    const chosen = paths[0];
    if (!chosen) return;
    await api.library.setLinkedAudio(assetId, chosen);
    refresh();
  }

  async function remove() {
    await api.library.setLinkedAudio(assetId, null);
    refresh();
  }

  return (
    <MediaPanel>
      <div className="flex items-center gap-2 px-2 py-1 text-sm">
        <Icon className="size-4 shrink-0 text-muted-foreground" name="audio" />
        <span className="min-w-0 flex-1 truncate text-foreground">
          {deck.soundtrack?.name ?? t("deck.audio.none")}
        </span>
        {/* `timingsSource` only certifies the OOXML timing data could be read,
         * not that any slide actually carries an advance delay — `autoAdvance`
         * (already derived from the slides themselves) is the fact this badge
         * claims to show. */}
        {deck.autoAdvance ? <Badge variant="blue">{t("deck.audio.autoAdvance")}</Badge> : null}
        {deck.soundtrack?.origin === "linked" ? (
          <Button onClick={() => void remove()} size="xs" variant="ghost">
            {t("deck.audio.remove")}
          </Button>
        ) : null}
        {deck.soundtrack?.origin !== "embedded" && deck.soundtrack?.origin !== "transition" ? (
          <Button onClick={() => void assign()} size="xs" variant="ghost">
            {deck.soundtrack ? t("deck.audio.change") : t("deck.audio.assign")}
          </Button>
        ) : null}
        <Tooltip content={t("deck.audio.help")}>
          <IconButton aria-label={t("deck.audio.help")} size="xs" variant="ghost">
            <Icon name="help" />
          </IconButton>
        </Tooltip>
        <IconButton aria-label={t("common.delete")} onClick={clearPreview} size="xs" variant="ghost">
          <Icon name="close" />
        </IconButton>
      </div>
    </MediaPanel>
  );
}

export function DeckSlides({ assetId, missingSince }: { assetId: number; missingSince: number | null }) {
  const t = useT();
  // A missing source file has nothing to convert — skip `useDeck`'s
  // ensure/conversion trigger entirely instead of surfacing its
  // "conversion failed" error for a file that was never going to exist.
  const { entry, environment, locateSoffice, markStale, reconvert } = useDeck(
    missingSince !== null ? null : assetId,
  );
  const base = useProjectionStore((s) => s.base);
  const previewIndex = usePreviewStore((s) => s.slideIndex);

  const isLive = base?.kind === "deck" && base.assetId === assetId;
  const liveIndex = isLive ? base.slideIndex : null;

  if (missingSince !== null) {
    return <PreviewMissingState />;
  }

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
    return <EmptyState icon="layers" title={t("deck.noSlides")} />;
  }

  return (
    <div className="flex min-h-0 flex-col gap-3">
      {entry.status === "stale" ? (
        <Callout tone="warning">
          <p>{t("deck.stale")}</p>
          <Button className="mt-2" onClick={reconvert} size="sm">
            {t("deck.reconvert")}
          </Button>
        </Callout>
      ) : null}
      {entry.status === "ready" && entry.deck ? (
        <DeckAudioStrip assetId={assetId} deck={entry.deck} />
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
