import { IconButton, Icon, MediaScrubber, type IconName } from "@renderer/components/ui";
import { useT } from "@renderer/lib/i18n/i18n-provider";
import { cn, formatClock } from "@renderer/lib/utils";

export type MediaTrackKind = "video" | "audio" | "image";

type MediaTrackRowProps = {
  className?: string;
  currentSeconds?: number;
  /** Omit entirely for content with no timeline (an image) — the row then
   *  skips the pause button, the clock readouts and the scrubber outright,
   *  instead of showing a meaningless 0:00/0:00. */
  durationSeconds?: number;
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
};

const kindIcon: Record<MediaTrackKind, IconName> = { video: "video", audio: "audio", image: "image" };
const kindTone: Record<MediaTrackKind, "primary" | "audio"> = {
  video: "primary",
  audio: "audio",
  image: "primary",
};

/**
 * `formatClock` widens its output past a bucket boundary (`m:ss` → `mm:ss` →
 * `h:mm:ss`), and a fixed `w-10` clock box left several pixels of dead space
 * inside itself on the shorter formats — on top of the row's own `gap-2`,
 * that read as a bigger gap around the clocks than anywhere else in the row.
 * Sizing the box to the widest string a given duration can actually produce
 * (in `ch`, which matches `tabular-nums` digit width) removes that dead
 * space without the box ever resizing while the clock ticks.
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
 * Every trailing control is a fixed-size `IconButton`, and the label is the
 * only element allowed to grow or shrink (`min-w-0 flex-1 truncate`) — a very
 * long file name eats into the label's own space, it never pushes a button
 * out of the row, and the controls always land in the same spot regardless
 * of label length. Every element in the row sits on the same flat `gap-2`
 * (see `clockWidthClass` above for why the clocks needed a content-sized box
 * to actually honor that gap instead of padding it out further).
 */
export function MediaTrackRow({
  className,
  currentSeconds = 0,
  durationSeconds,
  kind,
  label,
  hint,
  onSeek,
  onDelete,
  onStop,
  onTogglePause,
  paused = false,
}: MediaTrackRowProps) {
  const t = useT();
  const hasTiming = durationSeconds !== undefined;

  return (
    <div className={cn("flex flex-col gap-0.5 px-2 py-1", className)}>
      <div className={cn("flex items-center gap-2", paused && "opacity-70")}>
        <Icon
          className={cn("size-4 shrink-0", kind === "audio" ? "text-badge-audio" : "text-primary")}
          name={kindIcon[kind]}
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

        {hasTiming ? (
          <>
            <span className={cn(clockWidthClass(durationSeconds), "shrink-0 text-right text-xs tabular-nums text-subtle")}>
              {formatClock(currentSeconds)}
            </span>

            <MediaScrubber
              className="w-28 shrink-0"
              currentSeconds={currentSeconds}
              durationSeconds={durationSeconds}
              onSeek={onSeek}
              tone={kindTone[kind]}
            />

            <span className={cn(clockWidthClass(durationSeconds), "shrink-0 text-xs tabular-nums text-subtle")}>
              {formatClock(durationSeconds)}
            </span>
          </>
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

      {hint ? <p className="truncate pl-6 text-xs text-subtle">{hint}</p> : null}
    </div>
  );
}
