import { useT } from "@renderer/lib/i18n/i18n-provider";
import { Badge, EmptyState, MediaPanel, SlideGrid, ThumbTile } from "@renderer/components/ui";
import { MediaTrackRow } from "@renderer/components/shared/media-track-row";
import { PanelBody, PanelHeader } from "@renderer/components/shared/panel";
import { PreviewMissingState } from "@renderer/components/shared/preview-missing-state";
import { PreviewMonitor } from "@renderer/components/pages/monitors/preview-monitor";
import { useBibleStore } from "@renderer/stores/bible.store";
import { usePreviewStore } from "@renderer/stores/preview.store";
import { useProjectionStore } from "@renderer/stores/projection.store";
import { usePreviewContent } from "@renderer/lib/hooks/use-preview";
import { clearPreview, previewVerse } from "@renderer/lib/actions/preview";
import { goLive } from "@renderer/lib/actions/playback";
import { DeckSlides } from "./deck-slides";
import { PreviewMediaBar } from "./preview-media-bar";

/**
 * The centre column: the preview monitor pinned on top (a fixed box, the same
 * primitive the projector uses — see `Monitor`), and below it everything the
 * previewed item can put on screen, as a grid. A deck shows its slides, a
 * chapter shows its verses, a single media file shows itself. Clicking a
 * tile only moves the preview cursor — going live is always the EN VIVO
 * button's job, never this column.
 */
export function SlidesPanel() {
  const t = useT();
  const content = usePreviewContent();
  const verses = useBibleStore((s) => s.verses);
  const liveVerseIndex = useBibleStore((s) => s.currentVerseIndex);
  const target = usePreviewStore((s) => s.target);
  const base = useProjectionStore((s) => s.base);

  function body() {
    if (!content) {
      return <EmptyState description={t("slides.placeholderHint")} icon="layers" title={t("slides.placeholder")} />;
    }

    if (content.kind === "deck") {
      return <DeckSlides assetId={content.assetId} missingSince={content.missingSince} />;
    }

    // A verse being previewed brings its whole chapter along, so the operator
    // can walk the passage without going back to the resource tab.
    if (content.kind === "bible" && target?.kind === "verse" && verses.length > 0) {
      return (
        <SlideGrid>
          {verses.map((verse, index) => (
            <ThumbTile
              index={verse.verse}
              key={verse.id}
              live={liveVerseIndex === index && base?.kind === "bible"}
              onClick={() => previewVerse(index)}
              onDoubleClick={() => {
                previewVerse(index);
                void goLive();
              }}
              selected={target.verseIndex === index}
              text={verse.text}
            />
          ))}
        </SlideGrid>
      );
    }

    if (content.kind === "bible") {
      return (
        <SlideGrid>
          <ThumbTile label={content.reference} selected text={content.text} />
        </SlideGrid>
      );
    }

    if (content.kind === "text") {
      return (
        <SlideGrid>
          <ThumbTile index={1} selected text={content.body} />
        </SlideGrid>
      );
    }

    if (content.kind === "media" && content.asset.missingSince !== null) {
      return <PreviewMissingState assetId={content.asset.id} />;
    }

    // A live image needs no grid content of its own — the preview monitor
    // above already shows it full-size. Every other kind's dismiss control
    // lives outside this grid entirely (see `mediaBar` below), so there is
    // nothing left to render here for either.
    return null;
  }

  // Every previewed item gets a closable row below the monitor — the "x"
  // clears the preview back to empty (`clearPreview`), so an operator can back
  // out of a wrong pick without touching the schedule/library selection by
  // hand. Video/audio keep their own richer bar (scrubber, preview playback);
  // everything else is a plain `MediaTrackRow` with nothing but the close
  // button. A deck's dismiss control lives inside `DeckSlides` itself
  // (`DeckAudioStrip`), since that row already exists there.
  // Rendered as a sibling of the monitor, never inside `PanelBody`, so its
  // margins match `LiveMediaPanel`'s exactly instead of picking up an extra
  // layer of padding — see `MonitorsColumn`.
  const mediaBar = (() => {
    if (!content) return null;
    if (content.kind === "media") {
      if (content.asset.kind === "image") {
        return (
          <MediaPanel className="w-full">
            <MediaTrackRow kind="image" label={content.asset.name} onDelete={clearPreview} />
          </MediaPanel>
        );
      }
      return <PreviewMediaBar asset={content.asset} />;
    }
    if (content.kind === "bible") {
      return (
        <MediaPanel className="w-full">
          <MediaTrackRow kind="bible" label={content.reference} onDelete={clearPreview} />
        </MediaPanel>
      );
    }
    if (content.kind === "text") {
      return (
        <MediaPanel className="w-full">
          <MediaTrackRow kind="text" label={content.body} onDelete={clearPreview} />
        </MediaPanel>
      );
    }
    return null;
  })();

  const heading =
    content?.kind === "deck"
      ? content.title
      : content?.kind === "media"
        ? content.asset.name
        : content?.kind === "bible"
          ? content.reference
          : null;

  return (
    <>
      <PanelHeader
        actions={
          heading ? (
            <Badge className="min-w-0 flex-1 truncate" variant="blue">
              {heading}
            </Badge>
          ) : null
        }
        title={t("slides.title")}
      />
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
        <PreviewMonitor />
        {mediaBar}
        <PanelBody className="p-1.5">{body()}</PanelBody>
      </div>
    </>
  );
}
