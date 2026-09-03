import type { DragEvent } from "react";
import { cn } from "@renderer/lib/utils";
import { Badge, Icon, type BadgeVariant, type IconName } from "@renderer/components/ui";
import { useMediaAsset } from "@renderer/lib/hooks/use-media-asset";
import type { ServiceItemDTO } from "@shared/types/service";

const ICON_BY_KIND: Record<ServiceItemDTO["kind"], IconName> = {
  media: "video",
  ppt: "ppt",
  bible: "bible",
  text: "fileText",
};

const BADGE_BY_KIND: Record<ServiceItemDTO["kind"], BadgeVariant> = {
  media: "video",
  ppt: "ppt",
  bible: "bible",
  text: "neutral",
};

function useItemLabel(item: ServiceItemDTO): string {
  const asset = useMediaAsset(item.kind === "media" || item.kind === "ppt" ? item.mediaAssetId : null);
  if (item.kind === "media" || item.kind === "ppt") return item.title ?? asset?.name ?? "…";
  if (item.kind === "bible") return item.reference;
  return item.title ?? item.body.slice(0, 40);
}

function useItemIconAndBadge(item: ServiceItemDTO): { badge: BadgeVariant; icon: IconName } {
  const asset = useMediaAsset(item.kind === "media" ? item.mediaAssetId : null);
  if (item.kind === "media" && asset) {
    const map: Record<string, IconName> = { video: "video", image: "image", audio: "audio" };
    const badgeMap: Record<string, BadgeVariant> = { video: "video", image: "image", audio: "audio" };
    return { icon: map[asset.kind] ?? "file", badge: badgeMap[asset.kind] ?? "neutral" };
  }
  return { icon: ICON_BY_KIND[item.kind], badge: BADGE_BY_KIND[item.kind] };
}

type PlaylistRowProps = {
  active: boolean;
  dragOver: boolean;
  index: number;
  item: ServiceItemDTO;
  onClick: () => void;
  onDragStart: (e: DragEvent<HTMLLIElement>) => void;
  selected: boolean;
};

export function PlaylistRow({ active, dragOver, index, item, onClick, onDragStart, selected }: PlaylistRowProps) {
  const label = useItemLabel(item);
  const { icon, badge } = useItemIconAndBadge(item);

  return (
    <li
      className={cn(
        "flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors",
        selected ? "bg-active" : "hover:bg-hover",
        active && "ring-1 ring-primary",
        dragOver && "border-t-2 border-primary",
      )}
      data-index={index}
      draggable
      onClick={onClick}
      onDragStart={onDragStart}
    >
      <Badge className="shrink-0 px-1.5" variant={badge}>
        <Icon className="size-3" name={icon} />
      </Badge>
      <span className="truncate">{label}</span>
      {active ? <span className="ml-auto size-1.5 shrink-0 rounded-full bg-success" /> : null}
    </li>
  );
}
