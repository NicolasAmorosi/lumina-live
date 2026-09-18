import type { ReactNode } from "react";
import { useT } from "@renderer/lib/i18n/i18n-provider";
import { MediaPanel } from "@renderer/components/ui";
import { MediaTrackRow } from "@renderer/components/shared/media-track-row";
import { useProjectionStore } from "@renderer/stores/projection.store";
import { useAudioStore } from "@renderer/stores/audio.store";
import { useLiveHeading } from "@renderer/lib/hooks/use-live";
import {
  seekMedia,
  setMediaVolume,
  stopAudioTrack,
  toggleAudioTrackPause,
  toggleVideoPause,
} from "@renderer/lib/actions/media";
import { clearBaseContent } from "@renderer/lib/actions/playback";
import { mediaErrorKey, mediaTargetKey } from "@shared/types/projection";
import { assetUrl } from "@shared/urls";

const VIDEO_STATUS_KEY = mediaTargetKey({ kind: "video" });
const VIDEO_ERROR_KEY = mediaErrorKey({ kind: "video" });

/**
 * The global media control — every audio-producing thing live right now, in
 * one place: the video (if the base content is one), the current deck's own
 * soundtrack (if it has one), and every standalone audio track sent live
 * independently. Any number of these can sound at once; this panel is what
 * keeps that legible instead of leaving the operator guessing what's on.
 * A live image gets a row too, even though it has nothing to play — just its
 * name and a way to clear it back to empty.
 *
 * Renders nothing at all when silent, so a service with no audio in play
 * looks exactly like it did before this panel existed.
 */
export function LiveMediaPanel() {
  const t = useT();
  const base = useProjectionStore((s) => s.base);
  const videoPaused = useProjectionStore((s) => s.videoPaused);
  const videoVolume = useProjectionStore((s) => s.videoVolume);
  // The whole record, not a per-target selector: the number of rows below is
  // dynamic (0..N audio tracks), so there is no fixed set of hooks to call
  // one-per-track — see the Rules of Hooks. Indexing a single subscribed
  // object during render is still reactive and stays simple.
  const mediaStatus = useProjectionStore((s) => s.mediaStatus);
  const mediaErrors = useProjectionStore((s) => s.mediaErrors);
  const audioTracks = useAudioStore((s) => s.tracks);
  const heading = useLiveHeading();

  /** Only surface an error that still describes the url this row is about —
   *  same rule the monitors' notice follows, so the panel and the stage can
   *  never disagree about whether something is broken. */
  function errorFor(key: string, url: string): string | undefined {
    return mediaErrors[key]?.url === url ? t("media.loadErrorRow") : undefined;
  }

  const rows: ReactNode[] = [];

  if (base?.kind === "video") {
    const status = mediaStatus[VIDEO_STATUS_KEY];
    rows.push(
      <MediaTrackRow
        currentSeconds={status?.currentTimeSeconds ?? 0}
        durationSeconds={status?.durationSeconds ?? 0}
        error={errorFor(VIDEO_ERROR_KEY, assetUrl(base.assetId))}
        key="video"
        kind="video"
        label={heading ?? ""}
        onDelete={clearBaseContent}
        onSeek={(seconds) => seekMedia({ kind: "video" }, seconds)}
        onTogglePause={toggleVideoPause}
        onVolumeChange={(volume) => setMediaVolume({ kind: "video" }, volume)}
        paused={videoPaused}
        volume={videoVolume}
      />,
    );
  }

  if (base?.kind === "image") {
    rows.push(
      <MediaTrackRow
        error={errorFor(mediaErrorKey({ kind: "scene" }), assetUrl(base.assetId))}
        key="image"
        kind="image"
        label={heading ?? ""}
        onDelete={clearBaseContent}
      />,
    );
  }

  for (const track of audioTracks) {
    const status = mediaStatus[mediaTargetKey({ kind: "audio", trackId: track.trackId })];
    const isDeck = track.source === "deck";
    rows.push(
      <MediaTrackRow
        currentSeconds={status?.currentTimeSeconds ?? 0}
        durationSeconds={status?.durationSeconds ?? 0}
        error={errorFor(mediaErrorKey({ kind: "audio", trackId: track.trackId }), track.url)}
        key={track.trackId}
        kind="audio"
        label={isDeck ? t("media.deckMusic", { title: heading ?? "" }) : track.label}
        onSeek={(seconds) => seekMedia({ kind: "audio", trackId: track.trackId }, seconds)}
        onStop={isDeck ? undefined : () => stopAudioTrack(track.trackId)}
        onTogglePause={() => toggleAudioTrackPause(track.trackId)}
        onVolumeChange={(volume) => setMediaVolume({ kind: "audio", trackId: track.trackId }, volume)}
        paused={track.paused}
        volume={track.volume}
      />,
    );
  }

  if (rows.length === 0) return null;

  return <MediaPanel className="shrink-0">{rows}</MediaPanel>;
}
