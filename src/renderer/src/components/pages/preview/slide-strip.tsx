import { cn } from "@renderer/lib/utils";
import { useT } from "@renderer/lib/i18n/i18n-provider";
import type { DeckSlide } from "@shared/types/deck";

type SlideStripProps = {
  slides: DeckSlide[];
  /** 1-based, or null when this deck isn't the one being projected. */
  currentIndex: number | null;
  onSelect: (index: number) => void;
};

export function SlideStrip({ currentIndex, onSelect, slides }: SlideStripProps) {
  const t = useT();
  if (slides.length === 0) return null;

  return (
    <div className="flex shrink-0 gap-1 overflow-x-auto border-t border-border p-2">
      {slides.map((slide) => (
        <button
          className={cn(
            "shrink-0 overflow-hidden rounded border",
            slide.index === currentIndex ? "border-primary ring-1 ring-primary" : "border-border",
          )}
          key={slide.index}
          onClick={() => onSelect(slide.index)}
          type="button"
        >
          <img
            alt={t("deck.slideAlt", { index: slide.index })}
            className="h-12 w-auto"
            loading="lazy"
            src={slide.thumbUrl}
          />
        </button>
      ))}
    </div>
  );
}
