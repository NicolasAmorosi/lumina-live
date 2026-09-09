import { useT } from "@renderer/lib/i18n/i18n-provider";
import { EmptyState } from "@renderer/components/ui";

/** Shown wherever the previewed item's source file is gone from disk — a
 *  single media asset or a slide deck. */
export function PreviewMissingState() {
  const t = useT();
  return (
    <EmptyState description={t("preview.missingHint")} icon="alert" title={t("preview.missing")} tone="danger" />
  );
}
