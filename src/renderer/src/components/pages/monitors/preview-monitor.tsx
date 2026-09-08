import { useT } from "@renderer/lib/i18n/i18n-provider";
import { Monitor } from "@renderer/components/ui";
import { OutputView } from "@renderer/components/shared/output-view";
import { usePreviewContent, usePreviewOutput } from "@renderer/lib/hooks/use-preview";

/** Stage one of the two-stage flow: what the operator has queued up, never on
 *  the projector until EN VIVO — that control now sits above this monitor,
 *  shared with LIVE, instead of in this panel's own footer. Its position
 *  readout (slide 3/12…) lives in the column header — see `SlidesPanel.tsx`. */
export function PreviewMonitor() {
  const t = useT();
  const content = usePreviewContent();
  const output = usePreviewOutput(content);

  return (
    <Monitor empty={content?.kind === "media" ? content.asset.name : t("preview.placeholder")}>
      {output ? <OutputView mode="monitor" output={output} /> : undefined}
    </Monitor>
  );
}
