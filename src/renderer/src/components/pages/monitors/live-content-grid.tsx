import { useT } from "@renderer/lib/i18n/i18n-provider";
import { EmptyState, SlideGrid, ThumbTile } from "@renderer/components/ui";
import { useBibleStore } from "@renderer/stores/bible.store";
import { useProjectionStore } from "@renderer/stores/projection.store";
import { gotoSlide } from "@renderer/lib/actions/playback";
import { projectVerse } from "@renderer/lib/actions/bible";

/**
 * Below the LIVE monitor: whatever the projector is actually showing, as the
 * same kind of grid the centre column uses for the preview — a deck's slides,
 * or a passage's verses. Clicking a tile jumps the projector there directly;
 * there is no second stage here, this content is already live.
 */
export function LiveContentGrid() {
  const t = useT();
  const base = useProjectionStore((s) => s.base);
  const liveDeck = useProjectionStore((s) => s.liveDeck);
  const verses = useBibleStore((s) => s.verses);
  const currentVerseIndex = useBibleStore((s) => s.currentVerseIndex);

  if (base?.kind === "deck" && liveDeck) {
    return (
      <SlideGrid variant="fixed-2">
        {liveDeck.slides.map((slide) => (
          <ThumbTile
            index={slide.index}
            key={slide.index}
            live={base.slideIndex === slide.index}
            onClick={() => gotoSlide(slide.index)}
            selected={base.slideIndex === slide.index}
            src={slide.thumbUrl}
            title={t("deck.slideAlt", { index: slide.index })}
          />
        ))}
      </SlideGrid>
    );
  }

  // Only when the live verse actually belongs to the chapter loaded in the
  // Bible browser (see playback.ts) do we have a passage to walk — otherwise
  // it's a single scheduled reference, same as the centre column's fallback.
  if (base?.kind === "bible" && currentVerseIndex !== null && verses.length > 0) {
    return (
      <SlideGrid>
        {verses.map((verse, index) => (
          <ThumbTile
            index={verse.verse}
            key={verse.id}
            live={currentVerseIndex === index}
            onClick={() => projectVerse(index)}
            selected={currentVerseIndex === index}
            text={verse.text}
          />
        ))}
      </SlideGrid>
    );
  }

  if (base?.kind === "bible") {
    return (
      <SlideGrid>
        <ThumbTile label={base.reference} selected text={base.text} />
      </SlideGrid>
    );
  }

  return <EmptyState className="max-w-md" icon="layers" title={t("live.noSignal")} />;
}
