import { useEffect, useState, type DragEvent } from "react";
import { useT } from "@renderer/lib/i18n/i18n-provider";
import { ConfirmModal, Modal, ModalTitle } from "@renderer/components/shared/modal";
import {
  Badge,
  Button,
  DialogFooter,
  DialogHeader,
  EmptyState,
  Icon,
  IconButton,
  ListRow,
} from "@renderer/components/ui";
import { api } from "@renderer/lib/api";
import { toast } from "@renderer/lib/toast";
import { hideDragGhost, UTILITY_SCENE_MIME } from "@renderer/lib/dnd";
import { deleteScene, duplicateScene, reorderScenes, saveScene } from "@renderer/lib/actions/utility";
import { useUtilityStore } from "@renderer/stores/utility.store";
import type { MediaAsset } from "@shared/types/media";
import type { UtilityScene } from "@shared/types/utility";
import { emptySceneDraft, isDraftSavable, toDraft, toUpsert, type SceneDraft } from "./scene-draft";
import { SceneForm } from "./scene-form";
import { ScenePreview } from "./scene-preview";
import { TOOL_ICON, TOOL_LABEL } from "./tool-display";

/** Which row the form is editing. `null` = a scene that does not exist yet. */
type Editing = { sceneId: number | null; draft: SceneDraft; baseline: SceneDraft };

/** What a confirmation is about to do once the operator says yes. */
type Pending = { kind: "discard"; go: () => void } | { kind: "delete"; sceneId: number };

/**
 * The scene editor: the list on the left, one scene's fields on the right,
 * and the projector's own renderer at the top of it.
 *
 * Saving is EXPLICIT, unlike Ajustes, and that is a decision rather than an
 * inconsistency: a scene can be on the projector while it is being edited, and
 * writing on every keystroke would spell a new end message out letter by
 * letter in front of the congregation. The 16:9 preview is what makes the
 * delay free — the operator sees every change immediately, just not the room.
 *
 * Once saved, `saveScene` patches the live scene in place (`setLiveScene`), so
 * the projector picks up the new look without a transition and without
 * restarting the count. That is the F2 gate.
 */
export function ScenesModal({ onOpenChange, open }: { onOpenChange: (open: boolean) => void; open: boolean }) {
  const t = useT();
  const scenes = useUtilityStore((s) => s.scenes);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [saving, setSaving] = useState(false);
  const [dragOverId, setDragOverId] = useState<number | null>(null);
  const [imageAssets, setImageAssets] = useState<readonly MediaAsset[]>([]);
  const [addingImages, setAddingImages] = useState(false);

  const dirty = editing !== null && JSON.stringify(editing.draft) !== JSON.stringify(editing.baseline);
  /** A scene that does not exist yet has nothing to differ FROM, so `dirty` is
   *  the wrong gate for it: creating one and saving it untouched is a perfectly
   *  ordinary thing to do, and comparing a fresh draft against its own copy
   *  left the button dead. `dirty` keeps its own meaning — it is what the
   *  discard guard and «Deshacer cambios» ask. */
  const canSave = editing !== null && isDraftSavable(editing.draft) && (editing.sceneId === null || dirty);

  // The image library, for an image background's picker. Read on open rather
  // than kept in a store: it is one query, only this dialog wants it, and it
  // must reflect whatever the operator added since the last time they were
  // here.
  useEffect(() => {
    if (!open) return;
    void api.library
      .list("image")
      .then(setImageAssets)
      .catch((error: unknown) => console.warn("[scenes] could not list the image library", error));
  }, [open]);

  // Opening on the first scene is what makes the dialog useful on arrival; an
  // empty right-hand pane next to a full list reads as something broken.
  useEffect(() => {
    if (!open) {
      setEditing(null);
      setPending(null);
      return;
    }
    setEditing((current) => {
      if (current !== null) return current;
      const first = scenes[0];
      return first ? { sceneId: first.id, draft: toDraft(first), baseline: toDraft(first) } : null;
    });
  }, [open, scenes]);

  /** Every way of leaving the current form goes through here, so unsaved work
   *  can only ever be lost through the confirmation. */
  function leaveEditing(go: () => void) {
    if (dirty) {
      setPending({ kind: "discard", go });
      return;
    }
    go();
  }

  function select(scene: UtilityScene) {
    leaveEditing(() => setEditing({ sceneId: scene.id, draft: toDraft(scene), baseline: toDraft(scene) }));
  }

  function createNew() {
    leaveEditing(() => {
      const draft = emptySceneDraft(t("scenes.newName"));
      setEditing({ sceneId: null, draft, baseline: draft });
    });
  }

  async function handleSave() {
    if (!canSave || !editing) return;
    setSaving(true);
    try {
      const saved = await saveScene(toUpsert(editing.draft, editing.sceneId));
      if (!saved) return;
      setEditing({ sceneId: saved.id, draft: toDraft(saved), baseline: toDraft(saved) });
      toast.success(t("scenes.saved", { name: saved.name }));
    } finally {
      setSaving(false);
    }
  }

  async function handleDuplicate() {
    if (editing?.sceneId === null || editing === null) return;
    const source = scenes.find((scene) => scene.id === editing.sceneId);
    if (!source) return;
    const copy = await duplicateScene(source.id, t("scenes.copyName", { name: source.name }));
    if (copy) setEditing({ sceneId: copy.id, draft: toDraft(copy), baseline: toDraft(copy) });
  }

  async function handleDelete(sceneId: number) {
    if (!(await deleteScene(sceneId))) return;
    // The list in the store has already been refreshed by `deleteScene`; this
    // reads the version this render closed over, which is why the next scene
    // is picked by position rather than by "whatever is first now".
    const index = scenes.findIndex((scene) => scene.id === sceneId);
    const next = scenes[index + 1] ?? scenes[index - 1] ?? null;
    setEditing(next ? { sceneId: next.id, draft: toDraft(next), baseline: toDraft(next) } : null);
  }

  async function handleAddImages() {
    setAddingImages(true);
    try {
      const paths = await api.files.pick("image", true);
      if (paths.length === 0) return;
      const added = await api.library.add(paths, "image");
      setImageAssets(await api.library.list("image"));
      // Selecting the first one it just added is the point of the button: the
      // operator picked a file in order to use it, not in order to then find
      // it in a dropdown.
      const first = added[0];
      if (first && editing) {
        setEditing({
          ...editing,
          draft: {
            ...editing.draft,
            style: { ...editing.draft.style, background: { kind: "image", assetId: first.id, fit: "cover" } },
          },
        });
      }
    } catch (error) {
      console.warn("[scenes] could not add images", error);
      toast.danger(t("scenes.addImageError"));
    } finally {
      setAddingImages(false);
    }
  }

  function handleDrop(e: DragEvent<HTMLLIElement>, targetId: number) {
    e.preventDefault();
    setDragOverId(null);
    const raw = e.dataTransfer.getData(UTILITY_SCENE_MIME);
    const draggedId = Number(raw);
    if (!raw || Number.isNaN(draggedId) || draggedId === targetId) return;
    const ids = scenes.map((scene) => scene.id).filter((id) => id !== draggedId);
    const at = ids.indexOf(targetId);
    if (at < 0) return;
    void reorderScenes([...ids.slice(0, at), draggedId, ...ids.slice(at)]);
  }

  return (
    <>
      <Modal height="tall" onOpenChange={(next) => (next ? onOpenChange(true) : leaveEditing(() => onOpenChange(false)))} open={open} size="2xl">
        <DialogHeader className="border-b border-border">
          <ModalTitle>{t("scenes.title")}</ModalTitle>
          <IconButton
            onClick={() => leaveEditing(() => onOpenChange(false))}
            size="xs"
            title={t("common.close")}
            variant="ghost"
          >
            <Icon name="close" />
          </IconButton>
        </DialogHeader>

        <div className="flex min-h-0 flex-1">
          <div className="flex w-64 shrink-0 flex-col border-r border-border">
            <div className="shrink-0 border-b border-border p-2">
              <Button className="w-full" onClick={createNew} size="xs" variant="outline">
                <Icon name="add" />
                {t("scenes.new")}
              </Button>
            </div>
            <ul aria-label={t("scenes.listLabel")} className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-1.5">
              {scenes.map((scene) => (
                <ListRow
                  draggable
                  dropBefore={dragOverId === scene.id}
                  grip
                  key={scene.id}
                  leading={
                    <Badge className="px-2" variant="neutral">
                      <Icon className="size-3.5" name={TOOL_ICON[scene.tool]} />
                    </Badge>
                  }
                  onClick={() => select(scene)}
                  onDragEnd={() => setDragOverId(null)}
                  onDragLeave={() => setDragOverId((current) => (current === scene.id ? null : current))}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOverId((current) => (current === scene.id ? current : scene.id));
                  }}
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = "move";
                    // The scene's ID, never its index: `reorderScenes` refreshes
                    // the list from main mid-drag, and an index would then point
                    // at a different row. Same rule as `PROGRAM_ROW_MIME`.
                    e.dataTransfer.setData(UTILITY_SCENE_MIME, String(scene.id));
                    hideDragGhost(e);
                  }}
                  onDrop={(e) => handleDrop(e, scene.id)}
                  selected={editing?.sceneId === scene.id}
                  trailing={<span className="text-xs text-subtle">{t(TOOL_LABEL[scene.tool])}</span>}
                >
                  {scene.name}
                </ListRow>
              ))}
              {editing?.sceneId === null ? (
                <ListRow
                  leading={
                    <Badge className="px-2" variant="blue">
                      <Icon className="size-3.5" name="add" />
                    </Badge>
                  }
                  selected
                >
                  {editing.draft.name}
                </ListRow>
              ) : null}
            </ul>
          </div>

          <div className="flex min-w-0 min-h-0 flex-1 flex-col">
            {editing === null ? (
              <div className="relative flex-1">
                <EmptyState
                  action={
                    <Button onClick={createNew} size="sm" variant="primary">
                      {t("scenes.new")}
                    </Button>
                  }
                  description={t("scenes.emptyHint")}
                  icon="clock"
                  title={t("scenes.empty")}
                />
              </div>
            ) : (
              <>
                <div className="shrink-0 border-b border-border bg-background px-6 py-3">
                  <div className="mx-auto w-full max-w-md">
                    <ScenePreview draft={editing.draft} />
                  </div>
                </div>
                <div className="min-w-0 flex-1 overflow-y-auto p-6">
                  <SceneForm
                    addingImages={addingImages}
                    imageAssets={imageAssets}
                    onAddImages={() => void handleAddImages()}
                    onChange={(draft) => setEditing({ ...editing, draft })}
                    value={editing.draft}
                  />
                </div>
                <DialogFooter className="border-t border-border pt-4">
                  {editing.sceneId !== null ? (
                    <>
                      <Button
                        className="mr-auto"
                        onClick={() => setPending({ kind: "delete", sceneId: editing.sceneId! })}
                        size="sm"
                        variant="ghost"
                      >
                        <Icon name="remove" />
                        {t("common.delete")}
                      </Button>
                      <Button onClick={() => void handleDuplicate()} size="sm" variant="outline">
                        <Icon name="copy" />
                        {t("scenes.duplicate")}
                      </Button>
                    </>
                  ) : null}
                  <Button
                    disabled={!dirty}
                    onClick={() => setEditing({ ...editing, draft: editing.baseline })}
                    size="sm"
                    variant="ghost"
                  >
                    {t("scenes.revert")}
                  </Button>
                  <Button disabled={!canSave} loading={saving} onClick={() => void handleSave()} size="sm">
                    {t("common.save")}
                  </Button>
                </DialogFooter>
              </>
            )}
          </div>
        </div>
      </Modal>

      <ConfirmModal
        confirmLabel={pending?.kind === "delete" ? t("common.delete") : t("scenes.discard")}
        danger={pending?.kind === "delete"}
        description={pending?.kind === "delete" ? t("scenes.deleteBody") : t("scenes.discardBody")}
        onConfirm={async () => {
          if (!pending) return;
          if (pending.kind === "delete") await handleDelete(pending.sceneId);
          else pending.go();
        }}
        onOpenChange={(next) => {
          if (!next) setPending(null);
        }}
        open={pending !== null}
        title={pending?.kind === "delete" ? t("scenes.deleteTitle") : t("scenes.discardTitle")}
      />
    </>
  );
}
