import { useState, type DragEvent } from "react";
import { useT } from "@renderer/lib/i18n/i18n-provider";
import { Button, EmptyState, Icon, IconButton } from "@renderer/components/ui";
import { PanelBody, PanelHeader } from "@renderer/components/shared/panel";
import { useServiceStore } from "@renderer/stores/service.store";
import { useLibraryStore } from "@renderer/stores/library.store";
import { api } from "@renderer/lib/api";
import { PLAYLIST_INDEX_MIME, readMediaAssetDrag, readOsFilesDrag } from "@renderer/lib/dnd";
import { PlaylistRow } from "./playlist-row";
import type { AssetKind } from "@shared/constants";

const ADD_KINDS: { kind: AssetKind; labelKey: string }[] = [
  { kind: "ppt", labelKey: "playlist.addPpt" },
  { kind: "video", labelKey: "playlist.addVideo" },
  { kind: "image", labelKey: "playlist.addImage" },
  { kind: "audio", labelKey: "playlist.addAudio" },
];

export function PlaylistPanel() {
  const t = useT();
  const { activeIndex, items, moveDown, moveUp, removeAt, reorder, select, selectedIndex } = useServiceStore();
  const addItem = useServiceStore((s) => s.addItem);
  const clear = useServiceStore((s) => s.clear);
  const refreshLibrary = useLibraryStore((s) => s.refresh);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  function addAssetItem(assetId: number, kind: AssetKind) {
    if (kind === "ppt") {
      addItem({ kind: "ppt", mediaAssetId: assetId, title: null });
    } else {
      addItem({ kind: "media", mediaAssetId: assetId, title: null });
    }
  }

  async function handleAdd(kind: AssetKind) {
    const paths = await api.files.pick(kind, true);
    if (paths.length === 0) return;
    const assets = await api.library.add(paths, kind);
    await refreshLibrary(kind);
    for (const asset of assets) addAssetItem(asset.id, kind);
  }

  function dropTargetIndex(e: DragEvent<HTMLDivElement>): number {
    const li = (e.target as HTMLElement).closest<HTMLElement>("li[data-index]");
    return li ? Number(li.dataset.index) : items.length;
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOverIndex(dropTargetIndex(e));
  }

  async function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    const reorderFrom = e.dataTransfer.getData(PLAYLIST_INDEX_MIME);
    const draggedAsset = readMediaAssetDrag(e);
    const osFiles = readOsFilesDrag(e);
    const targetIndex = dropTargetIndex(e);
    setDragOverIndex(null);

    if (reorderFrom !== "") {
      reorder(Number(reorderFrom), targetIndex);
      return;
    }
    if (draggedAsset) {
      addAssetItem(draggedAsset.assetId, draggedAsset.kind);
      return;
    }
    const byKind = new Map<AssetKind, string[]>();
    for (const file of osFiles) byKind.set(file.kind, [...(byKind.get(file.kind) ?? []), file.path]);
    for (const [kind, paths] of byKind) {
      const assets = await api.library.add(paths, kind);
      await refreshLibrary(kind);
      for (const asset of assets) addAssetItem(asset.id, kind);
    }
  }

  return (
    <>
      <PanelHeader
        actions={
          <div className="flex flex-wrap gap-1">
            {ADD_KINDS.map(({ kind, labelKey }) => (
              <Button key={kind} onClick={() => void handleAdd(kind)} size="xs" variant="secondary">
                {t(labelKey)}
              </Button>
            ))}
          </div>
        }
        title={t("playlist.title")}
      />
      <PanelBody
        className="p-2"
        onDragLeave={() => setDragOverIndex(null)}
        onDragOver={handleDragOver}
        onDrop={(e) => void handleDrop(e)}
      >
        {items.length === 0 ? (
          <EmptyState description={t("playlist.emptyHint")} icon="layers" title={t("playlist.empty")} />
        ) : (
          <ul className="flex flex-col gap-1">
            {items.map((item, index) => (
              <PlaylistRow
                active={activeIndex === index}
                dragOver={dragOverIndex === index}
                index={index}
                item={item}
                key={item.id}
                onClick={() => select(index)}
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData(PLAYLIST_INDEX_MIME, String(index));
                }}
                selected={selectedIndex === index}
              />
            ))}
          </ul>
        )}
      </PanelBody>
      <div className="flex shrink-0 items-center gap-1 border-t border-border px-2 py-1.5">
        <IconButton
          disabled={selectedIndex === null || selectedIndex === 0}
          onClick={() => selectedIndex !== null && moveUp(selectedIndex)}
          size="sm"
          title={t("playlist.moveUp")}
        >
          <Icon name="chevronUp" />
        </IconButton>
        <IconButton
          disabled={selectedIndex === null || selectedIndex === items.length - 1}
          onClick={() => selectedIndex !== null && moveDown(selectedIndex)}
          size="sm"
          title={t("playlist.moveDown")}
        >
          <Icon name="chevronDown" />
        </IconButton>
        <Button
          disabled={selectedIndex === null}
          onClick={() => selectedIndex !== null && removeAt(selectedIndex)}
          size="xs"
          variant="danger"
        >
          <Icon name="remove" /> {t("playlist.remove")}
        </Button>
        <Button className="ml-auto" onClick={clear} size="xs" variant="ghost">
          {t("playlist.clear")}
        </Button>
      </div>
    </>
  );
}
