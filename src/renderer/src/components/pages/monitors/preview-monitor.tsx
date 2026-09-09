import { useCallback, useState } from "react";
import { useT } from "@renderer/lib/i18n/i18n-provider";
import { Monitor } from "@renderer/components/ui";
import { OutputView } from "@renderer/components/shared/output-view";
import { usePreviewContent, usePreviewOutput } from "@renderer/lib/hooks/use-preview";
import { usePreviewMediaStatus } from "@renderer/lib/hooks/use-preview-media-status";
import { attachPreviewVideo } from "@renderer/lib/actions/preview-playback";

/** Stage one of the two-stage flow: what the operator has queued up, never on
 *  the projector until EN VIVO — that control now sits above this monitor,
 *  shared with LIVE, instead of in this panel's own footer. Its position
 *  readout (slide 3/12…) lives in the column header — see `SlidesPanel.tsx`.
 *
 *  A previewed video CAN play here (muted, and only via the play button on
 *  `PreviewMediaBar`) — see `mode="preview"` on `OutputView`. `videoElement`
 *  is `useState`, not a plain ref, so `usePreviewMediaStatus` re-attaches its
 *  listeners whenever the element itself mounts/unmounts, not just once. */
export function PreviewMonitor() {
  const t = useT();
  const content = usePreviewContent();
  const output = usePreviewOutput(content);
  const [videoElement, setVideoElement] = useState<HTMLVideoElement | null>(null);
  usePreviewMediaStatus(videoElement);

  const handleVideoRef = useCallback((element: HTMLVideoElement | null) => {
    setVideoElement(element);
    attachPreviewVideo(element);
  }, []);

  const missing =
    (content?.kind === "media" && content.asset.missingSince !== null) ||
    (content?.kind === "deck" && content.missingSince !== null);

  const empty = missing
    ? t("preview.missing")
    : content?.kind === "media"
      ? content.asset.name
      : t("preview.placeholder");

  return (
    <Monitor empty={empty}>
      {output ? <OutputView mode="preview" output={output} videoRef={handleVideoRef} /> : undefined}
    </Monitor>
  );
}
