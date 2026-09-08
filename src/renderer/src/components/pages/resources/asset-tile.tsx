import type { DragEvent } from "react";
import { useT } from "@renderer/lib/i18n/i18n-provider";
import { Badge, ThumbTile, type IconName } from "@renderer/components/ui";
import { useDeckThumb } from "@renderer/lib/hooks/use-deck-thumb";
import { assetUrl } from "@shared/urls";
import type { AssetKind } from "@shared/constants";
import type { MediaAsset } from "@shared/types/media";

const ICON_BY_KIND: Record<AssetKind, IconName> = {
  video: "video",
  image: "image",
  audio: "audio",
  ppt: "ppt",
};

type AssetTileProps = {
  asset: MediaAsset;
  kind: AssetKind;
  onClick: () => void;
  onDoubleClick: () => void;
  onDragStart: (e: DragEvent<HTMLButtonElement>) => void;
  selected: boolean;
};

/** One library entry. A deck shows its real first slide once converted; a
 *  video shows its own first frame; everything else falls back to its icon. */
export function AssetTile({ asset, kind, onClick, onDoubleClick, onDragStart, selected }: AssetTileProps) {
  const t = useT();
  const deckThumb = useDeckThumb(kind === "ppt" ? asset.id : null);
  const url = assetUrl(asset.id);

  return (
    <ThumbTile
      draggable
      icon={ICON_BY_KIND[kind]}
      label={asset.name}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onDragStart={onDragStart}
      media={
        kind === "video" ? (
          <video className="size-full object-contain" muted preload="metadata" src={url} />
        ) : undefined
      }
      overlay={
        asset.missingSince !== null ? (
          <Badge className="absolute inset-x-1 bottom-1 justify-center" variant="danger">
            {t("library.missing")}
          </Badge>
        ) : undefined
      }
      selected={selected}
      src={kind === "image" ? url : kind === "ppt" ? deckThumb : null}
    />
  );
}
