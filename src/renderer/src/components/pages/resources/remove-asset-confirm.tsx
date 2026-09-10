import { useEffect, useState } from "react";
import { useT } from "@renderer/lib/i18n/i18n-provider";
import { ConfirmModal } from "@renderer/components/shared/modal";
import { Badge, Icon } from "@renderer/components/ui";
import { api } from "@renderer/lib/api";
import { forceRemoveAsset } from "@renderer/lib/actions/remove-asset";
import type { MediaAssetUsage } from "@shared/types/media";

type RemoveAssetConfirmProps = {
  /** `null` means closed — also the target asset, so no separate `open` flag. */
  assetId: number | null;
  assetMissing: boolean;
  onOpenChange: (open: boolean) => void;
};

/** "Eliminar igualmente" — the escape hatch from the in-use Callout. Confirms,
 *  then force-deletes: the asset AND every saved-program item pointing at it
 *  (see `forceRemoveAsset` / `main/services/media-asset-removal.ts`). */
export function RemoveAssetConfirm({ assetId, assetMissing, onOpenChange }: RemoveAssetConfirmProps) {
  const t = useT();
  const [usages, setUsages] = useState<MediaAssetUsage[]>([]);

  useEffect(() => {
    if (assetId === null) return;
    void api.library.usages(assetId).then(setUsages);
  }, [assetId]);

  return (
    <ConfirmModal
      confirmLabel={t("library.removeAnyway")}
      danger
      description={
        <div className="flex flex-col gap-3">
          <p className="text-foreground">{t("library.removeConfirmIntro")}</p>
          <ul className="flex flex-col gap-1 rounded-lg border border-border bg-muted p-1.5">
            {usages.map((usage) => (
              <li
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-foreground"
                key={usage.programId}
              >
                <Icon className="shrink-0 text-subtle" name="fileText" />
                <span className="min-w-0 flex-1 truncate">{usage.programName}</span>
                <Badge>{t("library.removeUsedInCount", { count: usage.itemCount })}</Badge>
              </li>
            ))}
          </ul>
          <p>{t("library.removeConfirmWarning")}</p>
          {assetMissing ? (
            <p className="flex items-start gap-1.5 text-warning">
              <Icon className="mt-0.5 shrink-0" name="alert" />
              <span>{t("library.removeMissingNote")}</span>
            </p>
          ) : null}
        </div>
      }
      onConfirm={() => forceRemoveAsset(assetId!)}
      onOpenChange={onOpenChange}
      open={assetId !== null}
      title={t("library.removeConfirmTitle")}
    />
  );
}
