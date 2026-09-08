import { useT } from "@renderer/lib/i18n/i18n-provider";
import { IconButton, Icon, MediaPanel, ProgressBar } from "@renderer/components/ui";
import { useProjectionStore } from "@renderer/stores/projection.store";
import { useLiveHeading } from "@renderer/lib/hooks/use-live";
import { DECK_SOUNDTRACK_TRACK_ID } from "@renderer/stores/audio.store";
import { advanceSlide, clearBaseContent } from "@renderer/lib/actions/playback";
import { restartDeck, toggleAutoplay } from "@renderer/effects/deck-autoplay";
import { mediaTargetKey } from "@shared/types/projection";

const DECK_AUDIO_STATUS_KEY = mediaTargetKey({ kind: "audio", trackId: DECK_SOUNDTRACK_TRACK_ID });

/**
 * Transport for the deck currently being projected — it lives under the LIVE
 * monitor, never under the preview one, so its buttons can only ever mean
 * "change what the congregation sees". That is the selected-vs-projected
 * confusion the COM version had.
 *
 * Styled as the same kind of row as `MediaTrackRow` (icon, truncated title,
 * fixed-size trailing buttons) so a PPT in flight reads as one more media
 * player instead of a one-off button bar — see `MediaPanel`.
 */
export function DeckTransport() {
  const t = useT();
  const base = useProjectionStore((s) => s.base);
  const liveDeck = useProjectionStore((s) => s.liveDeck);
  const autoplay = useProjectionStore((s) => s.autoplay);
  const heading = useLiveHeading();
  // Filtered by target: the shared slot also carries the video's or other
  // audio tracks' clocks, which must never be read as this deck's.
  const mediaStatus = useProjectionStore((s) => s.mediaStatus[DECK_AUDIO_STATUS_KEY]);

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
    <MediaPanel className="shrink-0">
      <div className="flex items-center gap-2 px-2 py-1">
        <Icon className="size-4 shrink-0 text-primary" name="ppt" />

        <span className="min-w-0 flex-1 truncate text-sm text-foreground">{heading ?? ""}</span>

        <IconButton
          aria-label={t("deck.previous")}
          disabled={current <= 1}
          onClick={() => advanceSlide(-1)}
          size="xs"
          variant="ghost"
        >
          <Icon name="prev" />
        </IconButton>

        {liveDeck.autoAdvance ? (
          <>
            <IconButton
              aria-label={autoplay === "playing" ? t("deck.pause") : t("deck.play")}
              onClick={() => toggleAutoplay()}
              size="xs"
              variant="ghost"
            >
              <Icon name={autoplay === "playing" ? "pause" : "play"} />
            </IconButton>
            <IconButton aria-label={t("deck.restart")} onClick={() => restartDeck()} size="xs" variant="ghost">
              <Icon name="restart" />
            </IconButton>
          </>
        ) : null}

        <IconButton
          aria-label={t("deck.next")}
          disabled={current >= total}
          onClick={() => advanceSlide(1)}
          size="xs"
          variant="ghost"
        >
          <Icon name="next" />
        </IconButton>

        <span className="shrink-0 whitespace-nowrap text-xs tabular-nums text-subtle">
          {t("deck.counter", { current, total })}
        </span>

        <IconButton aria-label={t("common.delete")} onClick={clearBaseContent} size="xs" variant="ghost">
          <Icon name="close" />
        </IconButton>
      </div>

      {elapsedRatio !== null ? (
        <div className="flex items-center gap-2 px-2 py-1">
          <ProgressBar className="flex-1" value={elapsedRatio} />
          {secondsLeft !== null ? (
            <span className="shrink-0 text-xs text-subtle">{t("deck.nextIn", { seconds: secondsLeft })}</span>
          ) : null}
        </div>
      ) : null}
    </MediaPanel>
  );
}
