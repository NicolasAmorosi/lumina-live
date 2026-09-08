import { useT } from "@renderer/lib/i18n/i18n-provider";
import { Badge, EmptyState, SlideGrid, ThumbTile } from "@renderer/components/ui";
import { PanelBody, PanelHeader } from "@renderer/components/shared/panel";
import { PreviewMonitor } from "@renderer/components/pages/monitors/preview-monitor";
import { useBibleStore } from "@renderer/stores/bible.store";
import { usePreviewStore } from "@renderer/stores/preview.store";
import { useProjectionStore } from "@renderer/stores/projection.store";
import { usePreviewContent } from "@renderer/lib/hooks/use-preview";
import { previewVerse } from "@renderer/lib/actions/preview";
import { goLive } from "@renderer/lib/actions/playback";
import { cn } from "@renderer/lib/utils";
import { assetUrl } from "@shared/urls";
import { DeckSlides } from "./deck-slides";

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
      return (
        <EmptyState
          className="max-w-md"
          description={t("slides.placeholderHint")}
          icon="layers"
          title={t("slides.placeholder")}
        />
      );
    }

    if (content.kind === "deck") return <DeckSlides assetId={content.assetId} />;

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

    return (
      <SlideGrid>
        <ThumbTile
          icon={content.asset.kind}
          label={content.asset.name}
          selected
          src={content.asset.kind === "image" ? assetUrl(content.asset.id) : null}
        />
      </SlideGrid>
    );
  }

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
        actions={heading ? <Badge variant="blue">{heading}</Badge> : undefined}
        title={t("slides.title")}
      />
      <div className="grid min-h-0 flex-1 grid-rows-2 gap-2 p-2">
        <PreviewMonitor />
        {/* Grids fill from the top; the empty/converting states are centred. */}
        <PanelBody
          className={cn("flex flex-col", !content && "items-center justify-center")}
        >
          {body()}
        </PanelBody>
      </div>
    </>
  );
}
