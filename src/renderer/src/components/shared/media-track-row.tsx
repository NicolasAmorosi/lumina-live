import { useState } from "react";
import { IconButton, Icon, MediaScrubber, VolumeControl, type IconName } from "@renderer/components/ui";
import { useT } from "@renderer/lib/i18n/i18n-provider";
import { cn, formatClock } from "@renderer/lib/utils";

export type MediaTrackKind = "video" | "audio" | "image" | "bible";

type MediaTrackRowProps = {
  className?: string;
  currentSeconds?: number;
  /** Omit entirely for content with no timeline (an image) — the row then
   *  skips the pause button and the whole transport line below, instead of
   *  showing a meaningless 0:00/0:00 and an empty bar. Such a row stays a
   *  single line: the different height is real information ("this has no
   *  time"), not an alignment defect. */
  durationSeconds?: number;
  /** What the projector reported it could not play, already translated.
   *  Replaces `hint` and re-tones the row — a track the operator believes is
   *  sounding, and isn't, is worth more than a tidy row. */
  error?: string | undefined;
  kind: MediaTrackKind;
  label: string;
  /** Compact second line under the label — e.g. "no suena hasta EN VIVO".
   *  Part of the row itself (not a sibling paragraph) so every caller gets
   *  it inside the same bordered container for free. */
  hint?: string;
  /** Omit to render the row without a seek control at all (duration unknown yet). */
  onSeek?: ((seconds: number) => void) | undefined;
  /** Clears this media back to nothing live — a video, a live PPT deck, or a
   *  live image. Distinct from `onStop`: this empties the projector's own
   *  content, not just a standalone audio track. */
  onDelete?: (() => void) | undefined;
  /** Present only where stopping makes sense — a standalone audio track.
   *  Absent for the video row and the deck's own music: nothing should be
   *  able to cut what's on the projector from here (that's `onDelete`'s job
   *  instead, where offered). */
  onStop?: (() => void) | undefined;
  /** Present only for a row that actually controls playback (the live panel).
   *  Absent in the preview bar, which only picks a start point. */
  onTogglePause?: (() => void) | undefined;
  paused?: boolean;
  /** Omit the pair to render the row without a level control — an image or a
   *  verse has nothing to turn down, and the preview bar reaches no speaker. */
  onVolumeChange?: ((volume: number) => void) | undefined;
  /** 0..1. Required whenever `onVolumeChange` is given. */
  volume?: number | undefined;
};

const kindIcon: Record<MediaTrackKind, IconName> = {
  video: "video",
  audio: "audio",
  image: "image",
  bible: "bible",
};
// "bible" never carries a duration, so this is never actually read for it —
// present only to keep the Record exhaustive.
const kindTone: Record<MediaTrackKind, "primary" | "audio"> = {
  video: "primary",
  audio: "audio",
  image: "primary",
  bible: "primary",
};

/**
 * `formatClock` widens its output past a bucket boundary (`m:ss` → `mm:ss` →
 * `h:mm:ss`), so both clocks are sized to the widest string this particular
 * duration can actually produce (in `ch`, which matches `tabular-nums` digit
 * width). Two effects, both load-bearing now that the scrubber sits between
 * them: no dead space inside a short clock, and the bar never resizes under
 * the pointer when the running clock crosses 9:59.
 */
function clockWidthClass(durationSeconds: number): string {
  if (durationSeconds >= 3600) return "w-[7ch]"; // h:mm:ss
  if (durationSeconds >= 600) return "w-[5ch]"; // mm:ss
  return "w-[4ch]"; // m:ss
}

/**
 * One row of the media transport UI — the live global panel, the preview
 * bar and the image-in-live row are all built from this, so they can never
 * drift in shape. Everything the operator needs to read (what it is, where it
 * is, how long it is) is always visible; nothing is behind a hover.
 *
 * ## The two lines
 *
 * **Identity and commands on top, position below.** The first line is icon,
 * name and every *control* (pause, level, dismiss); the second is the seek
 * bar spanning the full width, flanked by its two clocks. Stacking them is
 * what makes a row with several controls legible: while the scrubber shared
 * the first line it was squeezed to a `w-28` stub between fixed-size buttons,
 * which is both an unusable seek target and a visually crowded row. Full
 * width also means the bar's pixels map to the track at a useful resolution —
 * a second of a 40-minute sermon is no longer a sub-pixel.
 *
 * Every control on the first line is a fixed-size `IconButton`, and the label
 * is the only element allowed to grow or shrink (`min-w-0 flex-1 truncate`) —
 * a very long file name eats into the label's own space, it never pushes a
 * button out of the row, and the controls always land in the same spot
 * regardless of label length.
 *
 * Content with no timeline (an image, a verse, a text) renders the first line
 * only — see `durationSeconds`.
 */
export function MediaTrackRow({
  className,
  currentSeconds = 0,
  durationSeconds,
  error,
  kind,
  label,
  hint,
  onSeek,
  onDelete,
  onStop,
  onTogglePause,
  paused = false,
  onVolumeChange,
  volume,
}: MediaTrackRowProps) {
  const t = useT();
  const hasTiming = durationSeconds !== undefined;
  // Where the scrubber is painting while it is ahead of the reported position
  // — dragging, or holding a committed seek until the projector confirms it.
  // The clock reads this instead of `currentSeconds` so the operator can see
  // the second he is about to jump to, and so the two halves of the same
  // control can never show different positions.
  const [scrubSeconds, setScrubSeconds] = useState<number | null>(null);

  return (
    <div className={cn("flex flex-col gap-1 px-2 py-1.5", className)}>
      <div className={cn("flex items-center gap-2", paused && "opacity-70")}>
        <Icon
          className={cn(
            "size-4 shrink-0",
            error ? "text-danger-ink" : kind === "audio" ? "text-badge-audio-ink" : "text-primary-ink",
          )}
          name={error ? "alert" : kindIcon[kind]}
        />

        <span
          className={cn("min-w-0 flex-1 truncate text-sm", paused ? "text-muted-foreground" : "text-foreground")}
        >
          {label}
        </span>

        {onTogglePause ? (
          <IconButton
            aria-label={paused ? t("media.play") : t("media.pause")}
            onClick={onTogglePause}
            size="xs"
            variant="ghost"
          >
            <Icon name={paused ? "play" : "pause"} />
          </IconButton>
        ) : null}

        {onVolumeChange && volume !== undefined ? (
          <VolumeControl
            label={t("media.volumeFor", { name: label })}
            muteLabel={volume === 0 ? t("media.unmute") : t("media.mute")}
            onChange={onVolumeChange}
            tone={kindTone[kind]}
            value={volume}
          />
        ) : null}

        {onStop ? (
          <IconButton aria-label={t("media.stop")} onClick={onStop} size="xs" variant="ghost">
            <Icon name="close" />
          </IconButton>
        ) : onDelete ? (
          <IconButton aria-label={t("common.delete")} onClick={onDelete} size="xs" variant="ghost">
            <Icon name="close" />
          </IconButton>
        ) : (
          // Reserves the trailing button's footprint even when this row has
          // none (the deck's own music row, a video before it gained its
          // delete button) — every row in a panel stays the same height
          // whether or not it happens to end in a button.
          <span aria-hidden="true" className="size-6 shrink-0" />
        )}
      </div>

      {error ? (
        <p className="truncate pl-6 text-xs text-danger-ink">{error}</p>
      ) : hint ? (
        <p className="truncate pl-6 text-xs text-subtle">{hint}</p>
      ) : null}

      {hasTiming ? (
        // Deliberately not dimmed while paused, unlike the line above: a
        // paused track is exactly when the operator is aiming a seek, so the
        // one control he is about to use stays at full contrast.
        <div className="flex items-center gap-2">
          <span className={cn(clockWidthClass(durationSeconds), "shrink-0 text-xs tabular-nums text-subtle")}>
            {formatClock(scrubSeconds ?? currentSeconds)}
          </span>

          <MediaScrubber
            className="min-w-0 flex-1"
            currentSeconds={currentSeconds}
            durationSeconds={durationSeconds}
            onPositionChange={setScrubSeconds}
            onSeek={onSeek}
            tone={kindTone[kind]}
          />

          <span
            className={cn(clockWidthClass(durationSeconds), "shrink-0 text-right text-xs tabular-nums text-subtle")}
          >
            {formatClock(durationSeconds)}
          </span>
        </div>
      ) : null}
    </div>
  );
}
