import { useT } from "@renderer/lib/i18n/i18n-provider";
import { Monitor } from "@renderer/components/ui";
import { OutputView } from "@renderer/components/shared/output-view";
import { usePreviewContent, usePreviewOutput, usePreviewPosition } from "@renderer/lib/hooks/use-preview";

/** Stage one of the two-stage flow: what the operator has queued up, never on
 *  the projector until EN VIVO — that control now sits above this monitor,
 *  shared with LIVE, instead of in this panel's own footer. */
export function PreviewMonitor() {
  const t = useT();
  const content = usePreviewContent();
  const output = usePreviewOutput(content);
  const { index, total } = usePreviewPosition(content);

  return (
    <Monitor
      empty={content?.kind === "media" ? content.asset.name : t("preview.placeholder")}
      label={t("preview.title")}
      status={total > 1 ? t("preview.position", { current: index, total }) : ""}
      tone={content !== null ? "preview" : "idle"}
    >
      {output ? <OutputView mode="monitor" output={output} /> : undefined}
    </Monitor>
  );
}
