import { useT } from "@renderer/lib/i18n/i18n-provider";
import { MediaPanel } from "@renderer/components/ui";
import { MediaTrackRow } from "@renderer/components/shared/media-track-row";
import { usePreviewStore } from "@renderer/stores/preview.store";
import { useMediaDuration } from "@renderer/lib/hooks/use-media-duration";
import { assetUrl } from "@shared/urls";
import type { MediaAsset } from "@shared/types/media";

type PreviewMediaBarProps = { asset: MediaAsset };

/**
 * What a selected video/audio shows in the centre column instead of the old
 * icon-on-black tile: its duration, and a scrubber the operator drags to pick
 * where EN VIVO should start it. Purely informative otherwise — nothing plays
 * here, sound stays silent in the control window until it's actually live.
 * Same shell and row as the live media panel (`MediaPanel` + `MediaTrackRow`)
 * so the two columns' media controls never drift apart.
 */
export function PreviewMediaBar({ asset }: PreviewMediaBarProps) {
  const t = useT();
  const startAtSeconds = usePreviewStore((s) => s.startAtSeconds);
  const setStartAtSeconds = usePreviewStore((s) => s.setStartAtSeconds);
  const kind = asset.kind === "video" ? "video" : "audio";
  const duration = useMediaDuration(assetUrl(asset.id), kind);

  return (
    <MediaPanel className="w-full">
      <MediaTrackRow
        currentSeconds={startAtSeconds}
        durationSeconds={duration ?? 0}
        hint={t("media.previewHint")}
        kind={kind}
        label={asset.name}
        onSeek={duration ? setStartAtSeconds : undefined}
      />
    </MediaPanel>
  );
}
