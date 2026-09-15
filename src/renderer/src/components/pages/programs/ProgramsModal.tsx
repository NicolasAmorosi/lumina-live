import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { useT } from "@renderer/lib/i18n/i18n-provider";
import { Modal, ModalTitle } from "@renderer/components/shared/modal";
import {
  Button,
  Callout,
  DialogHeader,
  EmptyState,
  Icon,
  IconButton,
  Input,
  ListRow,
  Select,
  Skeleton,
  Tooltip,
} from "@renderer/components/ui";
import { cn } from "@renderer/lib/utils";
import { api } from "@renderer/lib/api";
import { toast } from "@renderer/lib/toast";
import { PROGRAM_ROW_MIME } from "@renderer/lib/dnd";
import { useProgramStore } from "@renderer/stores/program.store";
import {
  hasUnsavedChanges,
  openProgram,
  reorderPrograms,
  setProgramFavorite,
} from "@renderer/lib/actions/programs";
import { ProgramRow } from "./program-row";
import { ProgramSidePanel, type PanelMode } from "./program-side-panel";
import type { ProgramSummary } from "@shared/types/program";

function normalize(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

type FavoriteFilter = "all" | "favorites" | "others";

/** The floating clone standing in for the browser's native drag-ghost — see
 *  `handleDragOver`'s window listener. `offsetY` is where inside the row the
 *  cursor first grabbed it, kept constant so the clone doesn't jump to
 *  align its top with the cursor. `left`/`width` never change: only `top`
 *  tracks the cursor, which is what makes the drag read as vertical-only. */
type DragPreview = { height: number; id: number; left: number; name: string; offsetY: number; top: number; width: number };

/** Identity of what the side panel is editing. Used as its React `key`, so
 *  swapping between two programs remounts the panel with the right initial
 *  values instead of keeping the previous target's form state. */
function panelKey(mode: PanelMode): string {
  switch (mode.kind) {
    case "create":
      return "create";
    case "new":
      return "new";
    case "discard":
      return `discard:${mode.targetId}`;
    default:
      return `${mode.kind}:${mode.program.id}`;
  }
}

type ProgramsModalProps = {
  initialMode?: { kind: "create" } | undefined;
  onOpenChange: (open: boolean) => void;
  open: boolean;
};

/** Administration of saved programs: a searchable list is the main surface,
 *  and creating, editing, duplicating and deleting a program all happen
 *  through the side panel that expands the dialog itself sideways — never a
 *  second modal stacked on top. */
export function ProgramsModal({ initialMode, onOpenChange, open }: ProgramsModalProps) {
  const t = useT();
  const currentProgramId = useProgramStore((s) => s.currentProgramId);
  const currentItemCount = useProgramStore((s) => s.items.length);

  const [query, setQuery] = useState("");
  const [favoriteFilter, setFavoriteFilter] = useState<FavoriteFilter>("all");
  const [programs, setPrograms] = useState<ProgramSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [panelMode, setPanelMode] = useState<PanelMode | null>(null);
  // The side panel's form holds changes that aren't saved yet. Tracked here,
  // not inside the panel, because it's this component that owns every way of
  // replacing or closing it — see `setPanel`.
  const [panelDirty, setPanelDirty] = useState(false);
  // Armed by the first blocked action: the warning was shown, so the next one
  // goes through and drops the changes. Reset on every panel swap/close.
  const discardArmedRef = useRef(false);
  // -1 = no row keyboard-highlighted yet. Starting unselected avoids the first
  // row looking pre-selected merely from opening the modal — only arrow-key
  // navigation should ever paint that highlight.
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const itemRefs = useRef<(HTMLLIElement | null)[]>([]);
  const [dragOverId, setDragOverId] = useState<number | null>(null);
  const [dragPreview, setDragPreview] = useState<DragPreview | null>(null);

  // The clone has to keep tracking the cursor even past the list's own
  // bounds (e.g. dragged up over the search bar), so it listens on the
  // window rather than relying on this container's own onDragOver/onDragEnd.
  useEffect(() => {
    if (!dragPreview) return;
    function trackY(e: globalThis.DragEvent) {
      setDragPreview((prev) => (prev ? { ...prev, top: e.clientY - prev.offsetY } : prev));
    }
    function clear() {
      setDragPreview(null);
    }
    window.addEventListener("dragover", trackY);
    window.addEventListener("dragend", clear);
    return () => {
      window.removeEventListener("dragover", trackY);
      window.removeEventListener("dragend", clear);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only (re)subscribe when a drag starts/ends, not on every tracked pixel
  }, [dragPreview !== null]);

  async function refreshList() {
    setLoading(true);
    setLoadError(false);
    try {
      setPrograms(await api.programs.list());
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setFavoriteFilter("all");
    setPanelDirty(false);
    discardArmedRef.current = false;
    setPanelMode(initialMode?.kind === "create" ? { kind: "create" } : null);
    void refreshList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  /** Every path that replaces or closes the side panel goes through here:
   *  unsaved form changes cost one extra click (the first shows a warning and
   *  is refused, the second discards them), and the panel that lands next
   *  always starts from a clean slate. Returns whether the caller may
   *  proceed. */
  function setPanel(next: PanelMode | null): boolean {
    if (panelDirty && !discardArmedRef.current) {
      discardArmedRef.current = true;
      toast.warning(t("programs.panelDirtyWarning"));
      return false;
    }
    setPanelDirty(false);
    discardArmedRef.current = false;
    setPanelMode(next);
    return true;
  }

  const handlePanelDirtyChange = useCallback((dirty: boolean) => {
    setPanelDirty(dirty);
  }, []);

  /** The single exit from the dialog — Escape, the overlay and the header's X
   *  all land here, so none of them can slip past the guard. */
  function requestClose() {
    if (!setPanel(null)) return;
    onOpenChange(false);
  }

  const filtersActive = query.trim() !== "" || favoriteFilter !== "all";
  // Reordering a filtered view can't be mapped back onto the full list, so the
  // drag affordance is simply absent while a search or filter is on.
  const reorderEnabled = !filtersActive && programs.length > 1;

  const filtered = useMemo(() => {
    const q = normalize(query);
    return programs
      .filter((p) => (q ? normalize(p.name).includes(q) : true))
      .filter((p) => {
        if (favoriteFilter === "favorites") return p.favorite;
        if (favoriteFilter === "others") return !p.favorite;
        return true;
      });
  }, [programs, query, favoriteFilter]);

  async function toggleFavorite(program: ProgramSummary) {
    const updated = await setProgramFavorite(program.id, !program.favorite);
    if (updated) setPrograms((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
  }

  useEffect(() => {
    setHighlightedIndex(-1);
  }, [filtered]);

  useEffect(() => {
    itemRefs.current[highlightedIndex]?.scrollIntoView({ block: "nearest" });
  }, [highlightedIndex]);

  function requestOpen(id: number, name: string) {
    if (hasUnsavedChanges()) {
      setPanel({ kind: "discard", targetId: id, targetName: name });
      return;
    }
    if (!setPanel(null)) return;
    void openProgram(id).then(() => onOpenChange(false));
  }

  /** Which row a drag is hovering, by program id — `null` means past the last
   *  row, i.e. drop at the end. */
  function dropTargetId(e: DragEvent<HTMLDivElement>): number | null {
    const li = (e.target as HTMLElement).closest<HTMLElement>("li");
    if (!li) return null;
    // The unsaved-draft row has no id and always sits above every program, so
    // dropping on it means "put this first", not "put it last".
    if (li.dataset.id === undefined) return programs[0]?.id ?? null;
    return Number(li.dataset.id);
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    if (!reorderEnabled || !e.dataTransfer.types.includes(PROGRAM_ROW_MIME)) return;
    e.preventDefault();
    setDragOverId(dropTargetId(e));
  }

  /** Drop-before semantics: the dragged program is pulled out of the list
   *  first, then inserted where the row it was dropped on now sits — which is
   *  why there's no index-shift correction here. Applied optimistically and
   *  then replaced by whatever the main process actually stored. */
  function handleDrop(e: DragEvent<HTMLDivElement>) {
    const raw = e.dataTransfer.getData(PROGRAM_ROW_MIME);
    setDragOverId(null);
    if (!reorderEnabled || raw === "") return;
    e.preventDefault();

    const fromId = Number(raw);
    const targetId = dropTargetId(e);
    if (fromId === targetId) return;
    const from = programs.findIndex((p) => p.id === fromId);
    if (from === -1) return;

    const next = [...programs];
    const [moved] = next.splice(from, 1);
    const insertAt = targetId === null ? next.length : next.findIndex((p) => p.id === targetId);
    if (!moved || insertAt === -1) return;
    next.splice(insertAt, 0, moved);
    setPrograms(next);
    void reorderPrograms(next.map((p) => p.id)).then((stored) => {
      if (stored) setPrograms(stored);
      else void refreshList();
    });
  }

  function handleSearchKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (filtered.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightedIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const target = filtered[highlightedIndex];
      if (target) requestOpen(target.id, target.name);
    }
  }

  const showDraftRow = currentProgramId === null && currentItemCount > 0;

  return (
    <Modal
      className={cn(
        "overflow-hidden",
        // `84rem` = the base `2xl` width (`64rem`) + the side panel's own
        // `w-80` (`20rem`) — see `program-side-panel.tsx`. No transition here:
        // animating `max-width` stretched the header's empty middle (it
        // spans the full dialog width, but its title/close button don't grow
        // with it). The dialog jumps straight to its final size and only the
        // panel itself animates in — see `.wa-program-panel-enter`.
        panelMode !== null && "max-w-[84rem]",
      )}
      height="tall"
      onOpenChange={(next) => {
        if (!next) requestClose();
        else onOpenChange(next);
      }}
      open={open}
      size="2xl"
    >
      <DialogHeader className="border-b border-border">
        <ModalTitle>{t("programs.title")}</ModalTitle>
        <IconButton onClick={requestClose} size="xs" title={t("settings.close")} variant="ghost">
          <Icon name="close" />
        </IconButton>
      </DialogHeader>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          {/* `h-13` — the exact height of the side panel's own header, so the
              two seams line up when the panel expands the dialog sideways.
              The controls are `sm`-sized (the normal height) and just sit
              centered inside it — the container's height never follows theirs. */}
          <div className="flex h-13 shrink-0 items-center gap-2 border-b border-border px-6">
            <div className="min-w-0 flex-1">
              <Input
                icon="search"
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                placeholder={t("programs.searchPlaceholder")}
                size="sm"
                value={query}
              />
            </div>
            <Select
              className="w-36 shrink-0"
              onChange={(value) => setFavoriteFilter(value as FavoriteFilter)}
              options={[
                { label: t("programs.filterAll"), value: "all" },
                { label: t("programs.filterFavorites"), value: "favorites" },
                { label: t("programs.filterOthers"), value: "others" },
              ]}
              size="sm"
              value={favoriteFilter}
            />
            <Tooltip content={t("programs.newHint")} floating>
              <IconButton
                aria-label={t("programs.new")}
                onClick={() => setPanel({ kind: "new" })}
                size="sm"
                variant="ghost"
              >
                <Icon name="add" />
              </IconButton>
            </Tooltip>
          </div>

          <div
            className="relative min-h-0 flex-1 overflow-y-auto p-6"
            onDragLeave={() => setDragOverId(null)}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
          >
            {loading ? (
              <div className="flex flex-col gap-1">
                <Skeleton className="h-8" />
                <Skeleton className="h-8" />
                <Skeleton className="h-8" />
              </div>
            ) : loadError ? (
              <Callout tone="danger">
                <p>{t("programs.loadError")}</p>
                {/* `text-current` rather than the variant's own ink: a link
                    inside a toned Callout reads as part of that message. */}
                <Button className="mt-1 text-current" onClick={() => void refreshList()} variant="link">
                  {t("common.retry")}
                </Button>
              </Callout>
            ) : programs.length === 0 && !showDraftRow ? (
              <EmptyState icon="folderOpen" title={t("programs.empty")} />
            ) : filtered.length === 0 && filtersActive ? (
              <EmptyState icon="search" title={t("programs.noResults")} />
            ) : (
              <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
                {showDraftRow ? (
                  <ListRow
                    className="rounded-none px-4 py-1.5"
                    leading={<Icon className="text-subtle" name="filePlus" />}
                    onClick={() => setPanel({ kind: "create" })}
                    trailing={
                      <IconButton
                        aria-label={t("programs.save")}
                        onClick={(e) => {
                          e.stopPropagation();
                          setPanel({ kind: "create" });
                        }}
                        variant="ghost"
                      >
                        <Icon name="save" />
                      </IconButton>
                    }
                  >
                    {t("programs.untitled")}
                  </ListRow>
                ) : null}
                {filtered.map((program, index) => (
                  <ProgramRow
                    dragOver={dragOverId === program.id}
                    dragging={dragPreview?.id === program.id}
                    draggable={reorderEnabled}
                    isCurrent={program.id === currentProgramId}
                    key={program.id}
                    onDelete={() => setPanel({ kind: "delete", program })}
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData(PROGRAM_ROW_MIME, String(program.id));
                      const rect = e.currentTarget.getBoundingClientRect();
                      setDragPreview({
                        height: rect.height,
                        id: program.id,
                        left: rect.left,
                        name: program.name,
                        offsetY: e.clientY - rect.top,
                        top: rect.top,
                        width: rect.width,
                      });
                    }}
                    onDuplicate={() => setPanel({ kind: "duplicate", program })}
                    onEdit={() => setPanel({ kind: "edit", program })}
                    onOpen={() => requestOpen(program.id, program.name)}
                    onPreview={() => setPanel({ kind: "preview", program })}
                    onToggleFavorite={() => void toggleFavorite(program)}
                    program={program}
                    ref={(el) => {
                      itemRefs.current[index] = el;
                    }}
                    selected={highlightedIndex === index}
                  />
                ))}
              </ul>
            )}
          </div>
        </div>

        {panelMode ? (
          <ProgramSidePanel
            key={panelKey(panelMode)}
            mode={panelMode}
            onClose={() => setPanel(null)}
            onDirtyChange={handlePanelDirtyChange}
            onDone={(done, opened) => {
              // A completed action is never "unsaved changes": the panel
              // closes here without going through the guard.
              setPanelDirty(false);
              discardArmedRef.current = false;
              setPanelMode(null);
              void refreshList();
              // `discard` always switches the schedule; `new` only does when
              // "crear y abrir" was checked — either way, once the schedule
              // has moved on there's nothing left to manage here.
              if (done.kind === "discard" || opened) onOpenChange(false);
            }}
            onRequestOpen={requestOpen}
          />
        ) : null}
      </div>

      {dragPreview
        ? createPortal(
            <div
              className="pointer-events-none fixed z-[100] flex items-center gap-2 rounded-md border border-border bg-card px-4 text-sm text-foreground shadow-overlay"
              style={{
                height: dragPreview.height,
                left: dragPreview.left,
                top: dragPreview.top,
                width: dragPreview.width,
              }}
            >
              <Icon className="shrink-0 text-subtle" name="grip" />
              <span className="min-w-0 flex-1 truncate">{dragPreview.name}</span>
            </div>,
            document.body,
          )
        : null}
    </Modal>
  );
}
