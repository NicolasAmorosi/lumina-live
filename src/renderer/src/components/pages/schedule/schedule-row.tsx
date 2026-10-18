import type { DragEvent } from "react";
import { Badge, Icon, ListRow } from "@renderer/components/ui";
import { useItemIconAndBadge, useItemLabel } from "@renderer/lib/hooks/use-program-item-display";
import { useAudioStore } from "@renderer/stores/audio.store";
import { useConversion } from "@renderer/stores/conversion.store";
import { useT } from "@renderer/lib/i18n/i18n-provider";
import { PlateAirStatus } from "@renderer/components/shared/plate-air-status";
import type { ProgramItemDTO } from "@shared/types/program";

type ScheduleRowProps = {
  /** On the projector right now. */
  active: boolean;
  dragOver: boolean;
  index: number;
  item: ProgramItemDTO;
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
  const t = useT();
  const label = useItemLabel(item);
  // Planned into the service but not playable yet: said on the row itself, so
  // the operator finds out while preparing, not when pressing EN VIVO.
  const conversion = useConversion(item.kind === "media" ? item.mediaAssetId : null);
  const { icon, badge } = useItemIconAndBadge(item);
  // Audio never claims the on-air rail (`active`) — that means "this is what
  // the projector shows", and audio never is. Its own indicator here is what
  // tells the operator it's sounding without implying it's on screen.
  const sounding = useAudioStore(
    (s) =>
      item.kind === "media" && s.tracks.some((t) => t.source === "asset" && t.assetId === item.mediaAssetId),
  );

  return (
    <ListRow
      active={active}
      data-index={index}
      draggable
      dropBefore={dragOver}
      grip
      index={index + 1}
      leading={
        <Badge className="px-2" variant={badge}>
          <Icon className="size-3.5" name={icon} />
        </Badge>
      }
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onDragStart={onDragStart}
      selected={selected}
      trailing={
        sounding ? (
          <Icon className="size-3.5 animate-pulse text-badge-audio-ink" name="audio" />
        ) : conversion ? (
          <Badge variant={conversion.status === "failed" ? "danger" : "neutral"}>
            {conversion.status === "failed"
              ? t("conversion.badgeFailed")
              : conversion.status === "converting" && conversion.progress !== null
                ? t("conversion.badgeProgress", { percent: Math.round(conversion.progress * 100) })
                : t("conversion.badge")}
          </Badge>
        ) : item.kind === "plate" ? (
          // A plate never claims the on-air rail either — the content row
          // under it keeps that — so being up is said here instead.
          <PlateAirStatus plateId={item.overlayPlateId} />
        ) : undefined
      }
    >
      {label}
    </ListRow>
  );
}
