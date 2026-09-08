import { useState, type DragEvent } from "react";
import { useT } from "@renderer/lib/i18n/i18n-provider";
import { Button, EmptyState, Icon, IconButton } from "@renderer/components/ui";
import { PanelBody, PanelFooter, PanelHeader } from "@renderer/components/shared/panel";
import { useServiceStore } from "@renderer/stores/service.store";
import { useLibraryStore } from "@renderer/stores/library.store";
import { api } from "@renderer/lib/api";
import { SCHEDULE_INDEX_MIME, readMediaAssetDrag, readOsFilesDrag } from "@renderer/lib/dnd";
import { previewScheduleItem } from "@renderer/lib/actions/preview";
import { goLive } from "@renderer/lib/actions/playback";
import { ScheduleRow } from "./schedule-row";
import type { AssetKind } from "@shared/constants";

const ADD_KINDS: { kind: AssetKind; labelKey: string }[] = [
  { kind: "ppt", labelKey: "schedule.addPpt" },
  { kind: "video", labelKey: "schedule.addVideo" },
  { kind: "image", labelKey: "schedule.addImage" },
  { kind: "audio", labelKey: "schedule.addAudio" },
];

/** The service running order — EasyWorship's "Schedule", top-left. */
export function SchedulePanel() {
  const t = useT();
  const { activeIndex, items, moveDown, moveUp, removeAt, reorder, selectedIndex } = useServiceStore();
  const addItem = useServiceStore((s) => s.addItem);
  const clear = useServiceStore((s) => s.clear);
  const refreshLibrary = useLibraryStore((s) => s.refresh);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  function addAssetItem(assetId: number, kind: AssetKind) {
    addItem(
      kind === "ppt"
        ? { kind: "ppt", mediaAssetId: assetId, title: null }
        : { kind: "media", mediaAssetId: assetId, title: null },
    );
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
    const reorderFrom = e.dataTransfer.getData(SCHEDULE_INDEX_MIME);
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
        title={t("schedule.title")}
      />
      <PanelBody
        className="p-1.5"
        onDragLeave={() => setDragOverIndex(null)}
        onDragOver={handleDragOver}
        onDrop={(e) => void handleDrop(e)}
      >
        {items.length === 0 ? (
          <EmptyState description={t("schedule.emptyHint")} icon="layers" title={t("schedule.empty")} />
        ) : (
          <ul className="flex flex-col gap-0.5">
            {items.map((item, index) => (
              <ScheduleRow
                active={activeIndex === index}
                dragOver={dragOverIndex === index}
                index={index}
                item={item}
                key={item.id}
                onClick={() => previewScheduleItem(index)}
                onDoubleClick={() => {
                  previewScheduleItem(index);
                  void goLive();
                }}
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData(SCHEDULE_INDEX_MIME, String(index));
                }}
                selected={selectedIndex === index}
              />
            ))}
          </ul>
        )}
      </PanelBody>
      <PanelFooter>
        <IconButton
          disabled={selectedIndex === null || selectedIndex === 0}
          onClick={() => selectedIndex !== null && moveUp(selectedIndex)}
          size="xs"
          title={t("schedule.moveUp")}
        >
          <Icon name="chevronUp" />
        </IconButton>
        <IconButton
          disabled={selectedIndex === null || selectedIndex === items.length - 1}
          onClick={() => selectedIndex !== null && moveDown(selectedIndex)}
          size="xs"
          title={t("schedule.moveDown")}
        >
          <Icon name="chevronDown" />
        </IconButton>
        <Button
          disabled={selectedIndex === null}
          onClick={() => selectedIndex !== null && removeAt(selectedIndex)}
          size="xs"
          variant="danger"
        >
          <Icon name="remove" /> {t("schedule.remove")}
        </Button>
        <Button className="ml-auto" disabled={items.length === 0} onClick={clear} size="xs" variant="ghost">
          {t("schedule.clear")}
        </Button>
      </PanelFooter>
    </>
  );
}
