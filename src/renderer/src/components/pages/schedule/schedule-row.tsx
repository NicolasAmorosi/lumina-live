import type { DragEvent } from "react";
import { Badge, Icon, ListRow, type BadgeVariant, type IconName } from "@renderer/components/ui";
import { useMediaAsset } from "@renderer/lib/hooks/use-media-asset";
import { useDeckThumb } from "@renderer/lib/hooks/use-deck-thumb";
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

type ScheduleRowProps = {
  /** On the projector right now. */
  active: boolean;
  dragOver: boolean;
  index: number;
  item: ServiceItemDTO;
  /** Stage one: preview only. */
  onClick: () => void;
  /** Stage two: straight to the projector. */
  onDoubleClick: () => void;
  onDragStart: (e: DragEvent<HTMLLIElement>) => void;
  selected: boolean;
};

export function ScheduleRow({
  active,
  dragOver,
  index,
  item,
  onClick,
  onDoubleClick,
  onDragStart,
  selected,
}: ScheduleRowProps) {
  const label = useItemLabel(item);
  const { icon, badge } = useItemIconAndBadge(item);
  // Real first-slide thumbnail once the deck is converted; the static badge
  // stays as the fallback until then.
  const thumb = useDeckThumb(item.kind === "ppt" ? item.mediaAssetId : null);

  return (
    <ListRow
      active={active}
      data-index={index}
      draggable
      dropBefore={dragOver}
      index={index + 1}
      leading={
        thumb ? (
          <img alt="" className="h-5 w-8 rounded object-cover" src={thumb} />
        ) : (
          <Badge className="px-1.5" variant={badge}>
            <Icon className="size-3" name={icon} />
          </Badge>
        )
      }
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onDragStart={onDragStart}
      selected={selected}
    >
      {label}
    </ListRow>
  );
}
