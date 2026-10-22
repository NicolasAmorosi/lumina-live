import { useEffect, useState } from "react";
import { useT } from "@renderer/lib/i18n/i18n-provider";
import { ConfirmModal } from "@renderer/components/shared/modal";
import { ProgramUsages } from "@renderer/components/shared/program-usages";
import { Icon } from "@renderer/components/ui";
import { api } from "@renderer/lib/api";
import { forceRemoveAsset } from "@renderer/lib/actions/remove-asset";
import type { MediaAssetUsage } from "@shared/types/media";

type RemoveAssetConfirmProps = {
  /** `null` means closed — also the target asset, so no separate `open` flag. */
  assetId: number | null;
  onOpenChange: (open: boolean) => void;
};

/** "Eliminar igualmente" — the escape hatch from the in-use toast. Confirms,
 *  then force-deletes: the asset AND every saved-program item pointing at it
 *  (see `forceRemoveAsset` / `main/services/media-asset-removal.ts`).
 *
 *  Mounted exactly once, by `App` — the offer is a toast action raised from
 *  `lib/actions/remove-asset.ts` and its target lives in `ui.store`. Rendering
 *  it per `MediaBrowser` would put one dialog on screen per resource tab the
 *  operator has visited. */
export function RemoveAssetConfirm({ assetId, onOpenChange }: RemoveAssetConfirmProps) {
  const t = useT();
  const [usages, setUsages] = useState<MediaAssetUsage[]>([]);
  const [assetMissing, setAssetMissing] = useState(false);

  // Cleared and re-read per asset, with a cancellation guard. Without it the
  // dialog could list the programs of a PREVIOUSLY targeted asset while
  // confirming a force-delete of the current one — the list is the only thing
  // telling the operator what else is about to be modified, so it showing
  // someone else's data is the worst possible failure here. The early
  // `return` on `null` also used to leave the last list on screen for the
  // first instant of the next opening.
  //
  // `missingSince` is asked of main too, rather than taken as a prop: the
  // caller is now `App`, which has no library grid to look the asset up in —
  // and the grid was the wrong source anyway, since the Delete shortcut can
  // target a linked-folder row that was never in `byKind`.
  useEffect(() => {
    setUsages([]);
    setAssetMissing(false);
    if (assetId === null) return;
    let cancelled = false;
    void Promise.all([api.library.usages(assetId), api.library.get(assetId)])
      .then(([rows, asset]) => {
        if (cancelled) return;
        setUsages(rows);
        setAssetMissing(asset?.missingSince != null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [assetId]);

  return (
    <ConfirmModal
      confirmLabel={t("library.removeAnyway")}
      danger
      description={
        <div className="flex flex-col gap-3">
          <ProgramUsages
            intro={t("library.removeConfirmIntro")}
            usages={usages}
            warning={t("library.removeConfirmWarning")}
          />
          {assetMissing ? (
            <p className="flex items-start gap-1.5 text-warning-ink">
              <Icon className="mt-0.5" name="alert" />
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
