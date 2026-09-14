import { api } from "@renderer/lib/api";
import { forgetMediaAsset } from "@renderer/lib/hooks/use-media-asset";
import { t } from "@renderer/lib/i18n/i18n-provider";
import { toast } from "@renderer/lib/toast";

/**
 * Points a library row at the file the operator moved, keeping its id.
 *
 * The whole point of repairing rather than re-importing: the id is what the
 * saved programs, the unsaved order of service and the linked audio track all
 * reference. A re-import would be a different asset and would leave every one
 * of those pointing at a row that is still missing.
 *
 * The file picker itself lives in main (`library:relocate`) — it is the only
 * side that can open one, and it is also where the choice is checked against
 * the row's kind. `null` means the operator closed the dialog, which is not an
 * outcome worth a toast.
 *
 * The toast is raised here, from the gesture, rather than in whichever panel
 * offered the button: the same rule `F1` established — a panel can be mounted
 * more than once, an operator gesture happens once.
 */
export async function relocateAsset(assetId: number): Promise<void> {
  try {
    const asset = await api.library.relocate(assetId);
    if (asset === null) return;
    // The grids reload from main's own `library-changed` broadcast; this cache
    // is module-level and nobody else invalidates it.
    forgetMediaAsset(assetId);
    toast.success(t("library.relocated", { name: asset.name }));
  } catch (error) {
    console.error("[library] relocate failed", error);
    toast.danger(t("library.relocateFailed"));
  }
}
