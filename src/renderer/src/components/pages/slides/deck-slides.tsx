import { deckRequiresSoffice } from "@shared/constants";
import { useT } from "@renderer/lib/i18n/i18n-provider";
import {
  Badge,
  Button,
  Callout,
  DECK_GRID_COLUMNS,
  EmptyState,
  Icon,
  IconButton,
  MediaPanel,
  SLIDE_GRID_GAP_PX,
  ThumbTile,
  Tooltip,
  VirtualGrid,
  thumbTileHeight,
} from "@renderer/components/ui";
import { PreviewMissingState } from "@renderer/components/shared/preview-missing-state";
import { DeckConversionStatus } from "@renderer/components/shared/deck-conversion-status";
import { SofficeActions } from "@renderer/components/shared/soffice-missing";
import { useDeck } from "@renderer/lib/hooks/use-deck";
import { sofficeBlocks } from "@renderer/stores/deck.store";
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
      <div className="flex items-center gap-2 px-2 py-1.5 text-sm">
        <Icon className="size-4 text-muted-foreground" name="audio" />
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
        <IconButton aria-label={t("common.remove")} onClick={clearPreview} size="xs" variant="ghost">
          <Icon name="close" />
        </IconButton>
      </div>
    </MediaPanel>
  );
}

export function DeckSlides({
  assetId,
  ext,
  missingSince,
}: {
  assetId: number;
  ext: string;
  missingSince: number | null;
}) {
  const t = useT();
  // A PDF is handed straight to the rasterizer, so it converts and projects on
  // a machine that has no LibreOffice at all.
  const requiresSoffice = deckRequiresSoffice(ext);
  // A missing source file has nothing to convert — skip `useDeck`'s
  // ensure/conversion trigger entirely instead of surfacing its
  // "conversion failed" error for a file that was never going to exist.
  const { entry, environment, markStale, reconvert } = useDeck(
    missingSince !== null ? null : assetId,
    requiresSoffice,
  );
  const blocked = sofficeBlocks(environment, ext);
  const base = useProjectionStore((s) => s.base);
  const previewIndex = usePreviewStore((s) => s.slideIndex);

  const isLive = base?.kind === "deck" && base.assetId === assetId;
  const liveIndex = isLive ? base.slideIndex : null;

  if (missingSince !== null) {
    return <PreviewMissingState assetId={assetId} />;
  }

  const slides = entry?.deck?.slides ?? [];

  // Only in front of a deck with nothing to show: one already converted
  // projects without LibreOffice, and this gate used to hide its slides too.
  //
  // Main's own reason rides along: «not installed» is not the only one — a
  // sandboxed flatpak is installed and still unusable, and its fix is a
  // different package.
  if (blocked && slides.length === 0) {
    return (
      <Callout tone="warning">
        <p className="font-medium">{t("deck.noLibreOffice.title")}</p>
        <p className="mt-1 text-xs text-muted-foreground">{t("deck.noLibreOffice.body")}</p>
        {environment?.message ? <p className="mt-1 text-xs text-subtle">{environment.message}</p> : null}
        <SofficeActions className="mt-2" />
      </Callout>
    );
  }

  /** «Volver a convertir»/«Reintentar» over slides that are still there —
   *  replaced by the reason when it cannot work, rather than offered to fail. */
  const reconvertAction = (label: string) =>
    blocked ? (
      <p className="mt-1 text-xs text-muted-foreground">{t("deck.noLibreOffice.reconvertHint")}</p>
    ) : (
      <Button className="mt-2" onClick={reconvert} size="sm">
        {label}
      </Button>
    );

  // Only fall back to the loading/failed placeholder when there is nothing
  // else to show. A deck that already has a rendered grid (from a previous
  // `ready` DTO still sitting in the store) keeps showing it even while
  // `entry.status` flips to `converting` — e.g. `ensure()`'s IPC round-trip
  // for a deck that's actually a cache hit, or a real background
  // reconversion racing a stale grid. Tearing the grid down here is exactly
  // the "monitors lie to the operator" failure this app avoids everywhere
  // else — a slide grid that vanishes and reappears for a deck that was
  // never really being reconverted.
  // A cancelled conversion (`stale` with no DTO — see `DeckConversionStatus`)
  // belongs here too: the "no tiene diapositivas" empty state below would
  // accuse the file for something the operator chose to do. Spelled out rather
  // than written as `!== "ready"` so this only ever routes states that
  // `DeckConversionStatus` actually renders.
  if (
    slides.length === 0 &&
    (!entry ||
      entry.status === "converting" ||
      entry.status === "failed" ||
      (entry.status === "stale" && entry.deck === null))
  ) {
    return (
      <div className="self-center py-6">
        <DeckConversionStatus assetId={assetId} onRetry={reconvert} />
      </div>
    );
  }

  if (slides.length === 0) {
    return <EmptyState icon="layers" title={t("deck.noSlides")} />;
  }

  return (
    <div className="flex min-h-0 flex-col gap-3">
      {entry?.status === "stale" ? (
        <Callout tone="warning">
          <p>{t("deck.stale")}</p>
          {reconvertAction(t("deck.reconvert"))}
        </Callout>
      ) : null}
      {entry?.status === "failed" ? (
        <Callout tone="danger">
          <p>{entry.error ?? t("deck.failed")}</p>
          {reconvertAction(t("deck.retry"))}
        </Callout>
      ) : null}
      {entry?.status === "ready" && entry.deck ? (
        <DeckAudioStrip assetId={assetId} deck={entry.deck} />
      ) : null}
      <VirtualGrid
        aria-label={t("deck.title")}
        columns={DECK_GRID_COLUMNS}
        gap={SLIDE_GRID_GAP_PX}
        itemHeight={(columnWidth) => thumbTileHeight(columnWidth, { label: false })}
        itemKey={(slide) => slide.index}
        items={slides}
        renderItem={(slide, _index, { tabIndex }) => (
          <ThumbTile
            index={slide.index}
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
            tabIndex={tabIndex}
            title={t("deck.slideAlt", { index: slide.index })}
          />
        )}
        // A slide's `index` is 1-based, the way EasyWorship numbers them; this
        // grid works in array positions.
        scrollToIndex={previewIndex - 1}
      />
    </div>
  );
}
