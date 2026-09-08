import { useEffect, type DragEvent } from "react";
import { useT } from "@renderer/lib/i18n/i18n-provider";
import { Button, EmptyState } from "@renderer/components/ui";
import { PanelBody, PanelFooter } from "@renderer/components/shared/panel";
import { useLibraryStore } from "@renderer/stores/library.store";
import { useServiceStore } from "@renderer/stores/service.store";
import { api } from "@renderer/lib/api";
import { readOsFilesDrag, setMediaAssetDrag } from "@renderer/lib/dnd";
import { previewAsset } from "@renderer/lib/actions/preview";
import { goLive } from "@renderer/lib/actions/playback";
import { AssetTile } from "./asset-tile";
import type { AssetKind } from "@shared/constants";

/**
 * The library for one kind of asset, as a thumbnail grid. Click previews,
 * double-click goes live, drag adds to the schedule — an asset never has to be
 * in the schedule to be shown, which is what EasyWorship's resource area does.
 */
export function MediaBrowser({ kind }: { kind: AssetKind }) {
  const t = useT();
  const assets = useLibraryStore((s) => s.byKind[kind]);
  const selectedId = useLibraryStore((s) => s.selectedId);
  const refresh = useLibraryStore((s) => s.refresh);
  const addFiles = useLibraryStore((s) => s.addFiles);
  const remove = useLibraryStore((s) => s.remove);
  const addItem = useServiceStore((s) => s.addItem);

  useEffect(() => {
    void refresh(kind);
  }, [kind, refresh]);

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
      <PanelFooter>
        <Button onClick={() => void handleAdd()} size="xs" variant="secondary">
          {t("library.add")}
        </Button>
        <Button
          disabled={selectedId === null}
          onClick={() =>
            selectedId !== null &&
            addItem(
              kind === "ppt"
                ? { kind: "ppt", mediaAssetId: selectedId, title: null }
                : { kind: "media", mediaAssetId: selectedId, title: null },
            )
          }
          size="xs"
          variant="ghost"
        >
          {t("resources.addToSchedule")}
        </Button>
        <Button
          className="ml-auto"
          disabled={selectedId === null}
          onClick={() => selectedId !== null && void remove(selectedId)}
          size="xs"
          variant="ghost"
        >
          {t("library.remove")}
        </Button>
      </PanelFooter>
    </>
  );
}
