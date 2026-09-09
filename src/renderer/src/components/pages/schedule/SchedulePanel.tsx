import { useState, type DragEvent } from "react";
import { useT } from "@renderer/lib/i18n/i18n-provider";
import { Badge, EmptyState, Icon, IconButton, Tooltip } from "@renderer/components/ui";
import { PanelBody, PanelFooter, PanelHeader } from "@renderer/components/shared/panel";
import { useServiceStore } from "@renderer/stores/service.store";
import { useLibraryStore } from "@renderer/stores/library.store";
import { api } from "@renderer/lib/api";
import { SCHEDULE_INDEX_MIME, classifyExt, readMediaAssetDrag, readOsFilesDrag } from "@renderer/lib/dnd";
import { previewScheduleItem } from "@renderer/lib/actions/preview";
import { goLive } from "@renderer/lib/actions/playback";
import { ScheduleRow } from "./schedule-row";
import type { AssetKind } from "@shared/constants";

/** The service running order — EasyWorship's "Schedule", top-left. */
export function SchedulePanel() {
  const t = useT();
  const { activeIndex, items, moveDown, moveUp, removeAt, reorder, selectedIndex } = useServiceStore();
  const serviceName = useServiceStore((s) => s.currentServiceName);
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

  async function addPaths(paths: string[], kind: AssetKind) {
    const assets = await api.library.add(paths, kind);
    await refreshLibrary(kind);
    for (const asset of assets) addAssetItem(asset.id, kind);
  }

  /** One dialog, every supported extension at once — each picked file is then
   *  routed to its own kind by extension, same classifier the OS-file drag
   *  uses, so a single selection can mix PPTs, videos, images and audio. */
  async function handleAddAll() {
    const paths = await api.files.pick("all", true);
    if (paths.length === 0) return;
    const byKind = new Map<AssetKind, string[]>();
    for (const filePath of paths) {
      const ext = filePath.slice(filePath.lastIndexOf(".") + 1);
      const kind = classifyExt(ext);
      if (kind) byKind.set(kind, [...(byKind.get(kind) ?? []), filePath]);
    }
    for (const [kind, kindPaths] of byKind) await addPaths(kindPaths, kind);
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
    for (const [kind, paths] of byKind) await addPaths(paths, kind);
  }

  return (
    <>
      <PanelHeader
        actions={
          <Badge className="min-w-0 flex-1 truncate" variant="blue">
            {serviceName}
          </Badge>
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
        <Tooltip align="start" content={t("schedule.addAllHint")} placement="top">
          <IconButton aria-label={t("schedule.addAll")} onClick={() => void handleAddAll()} size="sm" variant="success">
            <Icon name="add" />
          </IconButton>
        </Tooltip>
        <Tooltip align="start" content={t("schedule.removeHint")} placement="top">
          <IconButton
            aria-label={t("schedule.remove")}
            disabled={selectedIndex === null}
            onClick={() => selectedIndex !== null && removeAt(selectedIndex)}
            size="sm"
            variant="warning"
          >
            <Icon name="close" />
          </IconButton>
        </Tooltip>
        <Tooltip align="start" content={t("schedule.moveUpHint")} placement="top">
          <IconButton
            aria-label={t("schedule.moveUp")}
            disabled={selectedIndex === null || selectedIndex === 0}
            onClick={() => selectedIndex !== null && moveUp(selectedIndex)}
            size="sm"
          >
            <Icon name="chevronUp" />
          </IconButton>
        </Tooltip>
        <Tooltip align="start" content={t("schedule.moveDownHint")} placement="top">
          <IconButton
            aria-label={t("schedule.moveDown")}
            disabled={selectedIndex === null || selectedIndex === items.length - 1}
            onClick={() => selectedIndex !== null && moveDown(selectedIndex)}
            size="sm"
          >
            <Icon name="chevronDown" />
          </IconButton>
        </Tooltip>
        <Tooltip className="ml-auto" content={t("schedule.clearHint")} placement="top">
          <IconButton
            aria-label={t("schedule.clear")}
            disabled={items.length === 0}
            onClick={clear}
            size="sm"
            variant="danger"
          >
            <Icon name="ban" />
          </IconButton>
        </Tooltip>
      </PanelFooter>
    </>
  );
}
