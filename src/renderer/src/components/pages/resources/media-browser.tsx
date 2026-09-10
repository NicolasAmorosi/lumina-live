import { useEffect, useState, type DragEvent } from "react";
import { useT } from "@renderer/lib/i18n/i18n-provider";
import { EmptyState, Icon, IconButton, Tooltip } from "@renderer/components/ui";
import { PanelBody, PanelFooter } from "@renderer/components/shared/panel";
import { folderAssetsKey, useLibraryStore } from "@renderer/stores/library.store";
import { useProgramStore } from "@renderer/stores/program.store";
import { useSettingsStore } from "@renderer/stores/settings.store";
import { api } from "@renderer/lib/api";
import { toast } from "@renderer/lib/toast";
import { readOsFilesDrag, setMediaAssetDrag } from "@renderer/lib/dnd";
import { previewAsset } from "@renderer/lib/actions/preview";
import { goLive } from "@renderer/lib/actions/playback";
import { removeAsset } from "@renderer/lib/actions/remove-asset";
import { addLinkedFolder, removeLinkedFolder, selectMediaSourceView } from "@renderer/lib/actions/library-folders";
import { AssetTile } from "./asset-tile";
import { MediaSourceBar } from "./media-source-bar";
import { RemoveAssetConfirm } from "./remove-asset-confirm";
import type { AssetKind } from "@shared/constants";

/**
 * The library for one kind of asset, as a thumbnail grid. Click previews,
 * double-click goes live, drag adds to the schedule — an asset never has to be
 * in the schedule to be shown, which is what EasyWorship's resource area does.
 *
 * Two sources feed the grid: the added-to-library list ("recent"), or one of
 * this kind's linked folders, browsed live from disk (`MediaSourceBar`).
 */
export function MediaBrowser({ kind }: { kind: AssetKind }) {
  const t = useT();
  const recentAssets = useLibraryStore((s) => s.byKind[kind]);
  const selectedId = useLibraryStore((s) => s.selectedId);
  const refresh = useLibraryStore((s) => s.refresh);
  const addFiles = useLibraryStore((s) => s.addFiles);
  const blockedAssetId = useLibraryStore((s) => s.blockedAssetId);
  const dismissBlocked = useLibraryStore((s) => s.dismissBlocked);
  const addItem = useProgramStore((s) => s.addItem);
  const [confirmAssetId, setConfirmAssetId] = useState<number | null>(null);
  const activeView = useLibraryStore((s) => s.activeView[kind]);
  const refreshFolder = useLibraryStore((s) => s.refreshFolder);
  const folders = useSettingsStore((s) => s.settings["library.linkedFolders"][kind]);
  const folderAssets = useLibraryStore((s) => s.folderAssets[folderAssetsKey(kind, activeView)]);

  const isFolderView = activeView !== "recent";
  const assets = isFolderView ? (folderAssets ?? []) : recentAssets;

  useEffect(() => {
    void refresh(kind);
  }, [kind, refresh]);

  useEffect(() => {
    if (isFolderView) void refreshFolder(kind, activeView);
  }, [kind, activeView, isFolderView, refreshFolder]);

  // Surfaced as a toast (rather than an in-panel Callout) — the store's
  // `blockedAssetId` only needs to live long enough to hand the id off here.
  // It still auto-dismisses like every other toast: the action stays
  // reachable through the library's own remove flow, so nothing is lost once
  // it disappears.
  useEffect(() => {
    if (blockedAssetId === null) return;
    const id = blockedAssetId;
    toast.danger(t("library.removeBlocked"), {
      action: { label: t("library.removeAnyway"), onClick: () => setConfirmAssetId(id) },
      durationMs: 6000,
    });
    dismissBlocked();
  }, [blockedAssetId, dismissBlocked, t]);

  async function handleAdd() {
    const paths = await api.files.pick(kind, true);
    if (paths.length > 0) await addFiles(paths, kind);
  }

  async function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    const byKind = new Map<AssetKind, string[]>();
    for (const file of readOsFilesDrag(e)) {
      byKind.set(file.kind, [...(byKind.get(file.kind) ?? []), file.path]);
    }
    for (const [dropped, paths] of byKind) await addFiles(paths, dropped);
  }

  return (
    <>
      <MediaSourceBar
        activeView={activeView}
        folders={folders}
        onAddFolder={() => void addLinkedFolder(kind)}
        onRemoveFolder={(folderPath) => void removeLinkedFolder(kind, folderPath)}
        onSelectView={(view) => selectMediaSourceView(kind, view)}
      />
      <PanelBody
        className="p-1.5"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => void handleDrop(e)}
      >
        {assets.length === 0 ? (
          <EmptyState description={t("resources.emptyHint")} icon={kind} title={t("resources.empty")} />
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-1.5">
            {assets.map((asset) => (
              <AssetTile
                asset={asset}
                key={asset.id}
                kind={kind}
                onClick={() => previewAsset(asset.id, kind)}
                onDoubleClick={() => {
                  previewAsset(asset.id, kind);
                  void goLive();
                }}
                onDragStart={(e) => setMediaAssetDrag(e, { assetId: asset.id, kind })}
                selected={selectedId === asset.id}
              />
            ))}
          </div>
        )}
      </PanelBody>
      <RemoveAssetConfirm
        assetId={confirmAssetId}
        assetMissing={recentAssets.find((a) => a.id === confirmAssetId)?.missingSince != null}
        onOpenChange={(open) => {
          if (!open) setConfirmAssetId(null);
        }}
      />
      <PanelFooter>
        <Tooltip align="start" content={t("library.addHint")} placement="top">
          <IconButton aria-label={t("library.add")} onClick={() => void handleAdd()} size="sm" variant="success">
            <Icon name="add" />
          </IconButton>
        </Tooltip>
        {!isFolderView ? (
          <Tooltip align="start" content={t("library.removeHint")} placement="top">
            <IconButton
              aria-label={t("library.remove")}
              disabled={selectedId === null}
              onClick={() => selectedId !== null && void removeAsset(selectedId)}
              size="sm"
              variant="warning"
            >
              <Icon name="close" />
            </IconButton>
          </Tooltip>
        ) : null}
        <Tooltip className="ml-auto" content={t("resources.addToScheduleHint")} placement="top">
          <IconButton
            aria-label={t("resources.addToSchedule")}
            disabled={selectedId === null}
            onClick={() =>
              selectedId !== null &&
              addItem(
                kind === "ppt"
                  ? { kind: "ppt", mediaAssetId: selectedId, title: null }
                  : { kind: "media", mediaAssetId: selectedId, title: null },
              )
            }
            size="sm"
            variant="primary"
          >
            <Icon name="addToSchedule" />
          </IconButton>
        </Tooltip>
      </PanelFooter>
    </>
  );
}
