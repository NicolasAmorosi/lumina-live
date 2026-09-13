import { useT } from "@renderer/lib/i18n/i18n-provider";
import { cn } from "@renderer/lib/utils";
import { IconButton, Icon, MediaPanel, ProgressBar } from "@renderer/components/ui";
import { useProjectionStore } from "@renderer/stores/projection.store";
import { useLiveHeading } from "@renderer/lib/hooks/use-live";
import { DECK_SOUNDTRACK_TRACK_ID } from "@renderer/stores/audio.store";
import { advanceSlide, clearBaseContent } from "@renderer/lib/actions/playback";
import { resyncDeck, restartDeck, toggleAutoplay } from "@renderer/effects/deck-autoplay";
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
  const autoplayMode = useProjectionStore((s) => s.autoplayMode);
  const heading = useLiveHeading();
  // Filtered by target: the shared slot also carries the video's or other
  // audio tracks' clocks, which must never be read as this deck's.
  const mediaStatus = useProjectionStore((s) => s.mediaStatus[DECK_AUDIO_STATUS_KEY]);

  if (base?.kind !== "deck" || !liveDeck) return null;

  const current = base.slideIndex;
  const total = liveDeck.slides.length;
  const advanceMs = liveDeck.slides[current - 1]?.advanceAfterMs ?? null;

  const autoplayActive = autoplay === "playing" || autoplay === "paused";
  // Once the operator navigates by hand, the slide cursor no longer matches
  // the audio clock this bar reads — showing its old countdown would just be
  // a wrong number. It's shown grayed out instead, with the same-slot button
  // that's the only way back to the synced flow (`resyncDeck`).
  const isDesynced = autoplayMode === "detached" && liveDeck.autoAdvance && autoplayActive;

  // Time-to-next-slide, only meaningful while synced to the soundtrack clock.
  // Kept visible while paused too — `mediaStatus` freezes at the paused
  // timestamp (the reporter stops firing `timeupdate` once the element is
  // paused), so the same calculation just yields a frozen ratio/countdown.
  let elapsedRatio: number | null = null;
  let secondsLeft: number | null = null;
  if (!isDesynced && advanceMs !== null && autoplayActive) {
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

      {elapsedRatio !== null || isDesynced ? (
        <div className="flex items-center gap-2 px-2 py-1">
          <ProgressBar className={cn("flex-1", isDesynced && "opacity-40")} value={elapsedRatio ?? 0} />
          {isDesynced ? (
            <button
              className="shrink-0 whitespace-nowrap text-xs font-medium text-primary hover:underline"
              onClick={() => resyncDeck()}
              type="button"
            >
              {t("deck.resync")}
            </button>
          ) : secondsLeft !== null ? (
            <span className="shrink-0 text-xs text-subtle">{t("deck.nextIn", { seconds: secondsLeft })}</span>
          ) : null}
        </div>
      ) : null}
    </MediaPanel>
  );
}
