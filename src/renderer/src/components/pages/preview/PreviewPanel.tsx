import { useMemo } from "react";
import { useT } from "@renderer/lib/i18n/i18n-provider";
import { Button, EmptyState, Icon } from "@renderer/components/ui";
import { PanelBody } from "@renderer/components/shared/panel";
import { useServiceStore } from "@renderer/stores/service.store";
import { useMediaAsset } from "@renderer/lib/hooks/use-media-asset";
import { presentSelected } from "@renderer/lib/actions/playback";
import { assetUrl } from "@shared/urls";
import { DeckPreview } from "./deck-preview";
import type { ServiceItemDTO } from "@shared/types/service";

export function PreviewPanel() {
  const t = useT();
  const { items, selectedIndex } = useServiceStore();
  const item: ServiceItemDTO | undefined = selectedIndex !== null ? items[selectedIndex] : undefined;

  const isMedia = item?.kind === "media" || item?.kind === "ppt";
  const asset = useMediaAsset(isMedia ? (item as { mediaAssetId: number }).mediaAssetId : null);
  const mediaUrl = asset ? assetUrl(asset.id) : null;

  const body = useMemo(() => {
    if (!item) {
      return (
        <EmptyState
          description={t("preview.placeholderHint")}
          icon="layers"
          title={t("preview.placeholder")}
        />
      );
    }
    if (item.kind === "media" && asset) {
      if (asset.kind === "video")
        return <video className="max-h-full max-w-full" controls src={mediaUrl ?? undefined} />;
      if (asset.kind === "image")
        return (
          <img
            alt={asset.name}
            className="max-h-full max-w-full object-contain"
            src={mediaUrl ?? undefined}
          />
        );
      return <p className="text-center text-sm">{asset.name}</p>;
    }
    if (item.kind === "ppt" && asset) {
      return <DeckPreview assetId={asset.id} title={item.title ?? asset.name} />;
    }
    if (item.kind === "bible") {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
          <p className="text-lg">{item.text}</p>
          <p className="text-sm text-subtle">{item.reference}</p>
        </div>
      );
    }
    return <p className="p-6 text-center text-sm">{(item as { body: string }).body}</p>;
  }, [item, asset, mediaUrl, t]);

  return (
    <>
      <PanelBody className="flex items-center justify-center bg-background/40 p-4">{body}</PanelBody>
      <div className="flex shrink-0 justify-center border-t border-border p-2">
        <Button className="w-full" onClick={() => void presentSelected()} size="lg" variant="live">
          <Icon name="play" /> {t("footer.present")}
        </Button>
      </div>
    </>
  );
}
