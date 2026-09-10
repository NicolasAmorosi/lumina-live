import type { BadgeVariant, IconName } from "@renderer/components/ui";
import type { ProgramItemDTO } from "@shared/types/program";
import { useMediaAsset } from "./use-media-asset";

const ICON_BY_KIND: Record<ProgramItemDTO["kind"], IconName> = {
  media: "video",
  ppt: "ppt",
  bible: "bible",
  text: "fileText",
};

const BADGE_BY_KIND: Record<ProgramItemDTO["kind"], BadgeVariant> = {
  media: "video",
  ppt: "ppt",
  bible: "bible",
  text: "neutral",
};

/** Display label for a program item, resolving a media/ppt title through the
 *  asset cache when the item itself has none. Shared by the schedule (live,
 *  editable rows) and the programs panel's read-only preview. */
export function useItemLabel(item: ProgramItemDTO): string {
  const asset = useMediaAsset(item.kind === "media" || item.kind === "ppt" ? item.mediaAssetId : null);
  if (item.kind === "media" || item.kind === "ppt") return item.title ?? asset?.name ?? "…";
  if (item.kind === "bible") return item.reference;
  return item.title ?? item.body.slice(0, 40);
}

/** Icon + badge tone for a program item — a media item refines its generic
 *  kind icon into the asset's actual video/image/audio icon once the asset
 *  loads. Shared by the schedule and the programs panel's read-only preview. */
export function useItemIconAndBadge(item: ProgramItemDTO): { badge: BadgeVariant; icon: IconName } {
  const asset = useMediaAsset(item.kind === "media" ? item.mediaAssetId : null);
  if (item.kind === "media" && asset) {
    const map: Record<string, IconName> = { video: "video", image: "image", audio: "audio" };
    const badgeMap: Record<string, BadgeVariant> = { video: "video", image: "image", audio: "audio" };
    return { icon: map[asset.kind] ?? "file", badge: badgeMap[asset.kind] ?? "neutral" };
  }
  return { icon: ICON_BY_KIND[item.kind], badge: BADGE_BY_KIND[item.kind] };
}
