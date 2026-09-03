import { useEffect, type DragEvent } from "react";
import { cn } from "@renderer/lib/utils";
import { useT } from "@renderer/lib/i18n/i18n-provider";
import { Badge, Button, Icon } from "@renderer/components/ui";
import { PanelBody, PanelHeader } from "@renderer/components/shared/panel";
import { useLibraryStore } from "@renderer/stores/library.store";
import { useServiceStore } from "@renderer/stores/service.store";
import { api } from "@renderer/lib/api";
import { readOsFilesDrag, setMediaAssetDrag } from "@renderer/lib/dnd";
import type { AssetKind } from "@shared/constants";

const TABS: AssetKind[] = ["video", "image", "audio"];
const TAB_LABEL_KEY: Record<AssetKind, string> = {
  video: "library.videos",
  image: "library.images",
  audio: "library.audios",
  ppt: "library.videos",
};

export function MediaLibraryPanel() {
  const t = useT();
  const { activeTab, byKind, remove, selectedId, select, setActiveTab } = useLibraryStore();
  const refresh = useLibraryStore((s) => s.refresh);
  const addFiles = useLibraryStore((s) => s.addFiles);
  const addItem = useServiceStore((s) => s.addItem);

  useEffect(() => {
    void refresh(activeTab);
  }, [activeTab, refresh]);

  const assets = byKind[activeTab];

  async function handleAdd() {
    const paths = await api.files.pick(activeTab, true);
    if (paths.length > 0) await addFiles(paths, activeTab);
  }

  async function handleDrop(e: DragEvent<HTMLUListElement>) {
    e.preventDefault();
    const byKind = new Map<AssetKind, string[]>();
    for (const file of readOsFilesDrag(e)) byKind.set(file.kind, [...(byKind.get(file.kind) ?? []), file.path]);
    for (const [kind, paths] of byKind) await addFiles(paths, kind);
  }

  return (
    <>
      <div className="flex shrink-0 gap-1 border-b border-border px-2 pt-2">
        {TABS.map((tab) => (
          <button
            className={cn(
              "flex items-center gap-1 rounded-t-lg px-2 py-1.5 text-xs font-medium",
              activeTab === tab ? "bg-surface text-primary" : "text-subtle hover:text-foreground",
            )}
            key={tab}
            onClick={() => setActiveTab(tab)}
            type="button"
          >
            <Icon className="size-3" name={tab} /> {t(TAB_LABEL_KEY[tab])}
          </button>
        ))}
      </div>
      <PanelHeader
        actions={
          <>
            <Button onClick={() => void handleAdd()} size="xs" variant="ghost">
              {t("library.add")}
            </Button>
            <Button
              disabled={selectedId === null}
              onClick={() => selectedId !== null && void remove(selectedId)}
              size="xs"
              variant="ghost"
            >
              {t("library.remove")}
            </Button>
          </>
        }
        title={`${assets.length} ${t("library.files")}`}
      />
      <PanelBody className="p-2">
        <ul className="flex flex-col gap-1" onDragOver={(e) => e.preventDefault()} onDrop={(e) => void handleDrop(e)}>
          {assets.map((asset) => (
            <li
              className={cn(
                "flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm",
                selectedId === asset.id ? "bg-active" : "hover:bg-hover",
              )}
              draggable
              key={asset.id}
              onClick={() => select(asset.id)}
              onDragStart={(e) => setMediaAssetDrag(e, { assetId: asset.id, kind: activeTab })}
              onDoubleClick={() =>
                addItem(
                  activeTab === "ppt"
                    ? { kind: "ppt", mediaAssetId: asset.id, title: null }
                    : { kind: "media", mediaAssetId: asset.id, title: null },
                )
              }
            >
              <span className="truncate">{asset.name}</span>
              {asset.missingSince !== null ? (
                <Badge className="ml-auto" variant="danger">
                  {t("library.missing")}
                </Badge>
              ) : null}
            </li>
          ))}
        </ul>
      </PanelBody>
    </>
  );
}
