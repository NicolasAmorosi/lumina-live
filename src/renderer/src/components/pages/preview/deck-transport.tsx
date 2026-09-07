import { useT } from "@renderer/lib/i18n/i18n-provider";
import { Button, Icon, ProgressBar } from "@renderer/components/ui";
import { useProjectionStore } from "@renderer/stores/projection.store";
import { advanceSlide } from "@renderer/lib/actions/playback";
import { restartDeck, toggleAutoplay } from "@renderer/effects/deck-autoplay";

/**
 * Transport for the deck currently being projected. Only rendered when the
 * selected item IS the live one — otherwise next/prev would silently target
 * nothing, which is the selected-vs-projected confusion the COM version had.
 */
export function DeckTransport() {
  const t = useT();
  const base = useProjectionStore((s) => s.base);
  const liveDeck = useProjectionStore((s) => s.liveDeck);
  const autoplay = useProjectionStore((s) => s.autoplay);
  const mediaStatus = useProjectionStore((s) => s.mediaStatus);

  if (base?.kind !== "deck" || !liveDeck) return null;

  const current = base.slideIndex;
  const total = liveDeck.slides.length;
  const advanceMs = liveDeck.slides[current - 1]?.advanceAfterMs ?? null;

  // Time-to-next-slide, only meaningful while synced to the soundtrack clock.
  let elapsedRatio: number | null = null;
  let secondsLeft: number | null = null;
  if (advanceMs !== null && autoplay === "playing") {
    const boundary = liveDeck.cumulativeMs[current + 1];
    const start = liveDeck.cumulativeMs[current];
    if (boundary !== undefined && start !== undefined && mediaStatus) {
      const now = mediaStatus.currentTimeSeconds * 1000;
      const ratio = (now - start) / Math.max(1, boundary - start);
      elapsedRatio = Math.min(1, Math.max(0, ratio));
      secondsLeft = Math.max(0, Math.round((boundary - now) / 1000));
    }
  }

  return (
    <div className="flex shrink-0 flex-col gap-1.5 border-t border-border p-2">
      <div className="flex items-center justify-center gap-2">
        <Button disabled={current <= 1} onClick={() => advanceSlide(-1)} size="sm">
          <Icon name="prev" /> {t("deck.previous")}
        </Button>

        {liveDeck.autoAdvance ? (
          <>
            <Button onClick={() => toggleAutoplay()} size="sm" variant="secondary">
              <Icon name={autoplay === "playing" ? "pause" : "play"} />
              {autoplay === "playing" ? t("deck.pause") : t("deck.play")}
            </Button>
            <Button onClick={() => restartDeck()} size="sm" variant="ghost">
              {t("deck.restart")}
            </Button>
          </>
        ) : null}

        <span className="text-xs text-subtle">
          {t("deck.slideCounter", { current, total })}
        </span>

        <Button disabled={current >= total} onClick={() => advanceSlide(1)} size="sm">
          {t("deck.next")} <Icon name="next" />
        </Button>
      </div>

      {elapsedRatio !== null ? (
        <div className="flex items-center gap-2">
          <ProgressBar className="flex-1" value={elapsedRatio} />
          {secondsLeft !== null ? (
            <span className="shrink-0 text-xs text-subtle">
              {t("deck.nextIn", { seconds: secondsLeft })}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
