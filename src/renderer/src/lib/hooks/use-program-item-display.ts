import type { BadgeVariant, IconName } from "@renderer/components/ui";
import type { ProgramItemDTO } from "@shared/types/program";
import { findScene, useUtilityStore } from "@renderer/stores/utility.store";
import { TOOL_ICON } from "@renderer/components/pages/functions/tool-display";
import { useMediaAsset } from "./use-media-asset";

const ICON_BY_KIND: Record<ProgramItemDTO["kind"], IconName> = {
  media: "video",
  ppt: "ppt",
  bible: "bible",
  utility: "clock",
};

const BADGE_BY_KIND: Record<ProgramItemDTO["kind"], BadgeVariant> = {
  media: "video",
  ppt: "ppt",
  bible: "bible",
  // Deliberately `neutral`: every ALPS hue is already spoken for by another
  // content type, and inventing one outside the church's palette is against
  // `docs/knowledge/06-ui-and-theme.md`. The tool's own icon is what tells a
  // countdown from a clock.
  utility: "neutral",
};

/** The scene a `utility` item points at, or `null` for anything else. Its own
 *  hook because both display hooks need it and neither may call it behind a
 *  branch. The scene is resolved on every render rather than copied into the
 *  item: a row saved in March must show the scene as it looks today, which is
 *  the whole reason `program_items` holds an id and not a snapshot. */
function useItemScene(item: ProgramItemDTO) {
  const scenes = useUtilityStore((s) => s.scenes);
  return item.kind === "utility" ? findScene(scenes, item.utilitySceneId) : null;
}

/** Display label for a program item, resolving a media/ppt title through the
 *  asset cache — and a utility title through the scene list — when the item
 *  itself has none. Shared by the schedule (live, editable rows) and the
 *  programs panel's read-only preview. */
export function useItemLabel(item: ProgramItemDTO): string {
  const asset = useMediaAsset(item.kind === "media" || item.kind === "ppt" ? item.mediaAssetId : null);
  const scene = useItemScene(item);
  if (item.kind === "media" || item.kind === "ppt") return item.title ?? asset?.name ?? "…";
  if (item.kind === "utility") return item.title ?? scene?.name ?? "…";
  return item.reference;
}

/** Icon + badge tone for a program item — a media item refines its generic
 *  kind icon into the asset's actual video/image/audio icon once the asset
 *  loads, and a utility item into its tool's. Shared by the schedule and the
 *  programs panel's read-only preview. */
export function useItemIconAndBadge(item: ProgramItemDTO): { badge: BadgeVariant; icon: IconName } {
  const asset = useMediaAsset(item.kind === "media" ? item.mediaAssetId : null);
  const scene = useItemScene(item);
  if (item.kind === "media" && asset) {
    const map: Record<string, IconName> = { video: "video", image: "image", audio: "audio" };
    const badgeMap: Record<string, BadgeVariant> = { video: "video", image: "image", audio: "audio" };
    return { icon: map[asset.kind] ?? "file", badge: badgeMap[asset.kind] ?? "neutral" };
  }
  if (item.kind === "utility" && scene) return { icon: TOOL_ICON[scene.tool], badge: "neutral" };
  return { icon: ICON_BY_KIND[item.kind], badge: BADGE_BY_KIND[item.kind] };
}
