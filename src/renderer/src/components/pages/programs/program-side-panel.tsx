import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useT, type TParams } from "@renderer/lib/i18n/i18n-provider";
import { Button, Callout, EmptyState, Icon, IconButton, Input, Skeleton, Switch, Title, Tooltip } from "@renderer/components/ui";
import { cn } from "@renderer/lib/utils";
import { api } from "@renderer/lib/api";
import { toast } from "@renderer/lib/toast";
import {
  createProgram,
  createProgramFromCurrent,
  deleteProgram,
  duplicateProgram,
  hasUnsavedChanges,
  openProgram,
  updateProgramMeta,
  type ProgramMetaInput,
} from "@renderer/lib/actions/programs";
import { ProgramItemList } from "./program-item-list";
import type { ProgramDTO, ProgramSummary } from "@shared/types/program";

export type PanelMode =
  | { kind: "create" }
  | { kind: "new" }
  | { kind: "edit"; program: ProgramSummary }
  | { kind: "delete"; program: ProgramSummary }
  | { kind: "discard"; targetId: number; targetName: string }
  | { kind: "preview"; program: ProgramSummary }
  | { kind: "duplicate"; program: ProgramSummary };

type FormValues = { favorite: boolean; name: string; notes: string };

/** The form's values as the panel was opened, so "dirty" means "differs from
 *  what's stored", not "the operator touched a field". Read once per mount —
 *  `ProgramsModal` keys the panel by mode + target id, so switching programs
 *  remounts it instead of leaving a stale form behind. */
function initialForm(mode: PanelMode, t: (key: string, params?: TParams) => string): FormValues {
  if (mode.kind === "edit") {
    return { favorite: mode.program.favorite, name: mode.program.name, notes: mode.program.notes ?? "" };
  }
  if (mode.kind === "duplicate") {
    return {
      favorite: mode.program.favorite,
      name: t("programs.duplicateName", { name: mode.program.name }),
      notes: mode.program.notes ?? "",
    };
  }
  return { favorite: false, name: "", notes: "" };
}

type ProgramSidePanelProps = {
  mode: PanelMode;
  /** Cancel — the caller may refuse it (unsaved form changes need a second
   *  click, see `ProgramsModal`'s guard), so the panel must never assume it
   *  actually closed. */
  onClose: () => void;
  /** Reports whether the form holds changes that a swap/close would throw
   *  away. Only form modes can ever be dirty. */
  onDirtyChange: (dirty: boolean) => void;
  /** Called with the mode that just completed, so the caller can react per
   *  mode (close this panel, refresh the list; for `discard`, also close the
   *  whole modal since the schedule just switched programs). Never called on
   *  cancel — and it's the caller, not the panel, that closes on success, so
   *  the unsaved-changes guard never fires on a save that just succeeded. */
  onDone: (mode: PanelMode, opened?: boolean) => void;
  /** "Abrir" in `preview` mode goes through the same unsaved-changes guard as
   *  double-clicking a row — the caller may swap this panel to `discard`
   *  instead of opening right away. */
  onRequestOpen: (id: number, name: string) => void;
};

/** The `create`/`new`/`edit`/`delete`/`discard`/`preview`/`duplicate` panel
 *  that expands the modal sideways instead of stacking a second modal on top
 *  — see `ProgramsModal`. `create`/`new`/`edit`/`duplicate` all share the
 *  same form — duplicating a program lets you change every field, not just
 *  its name. `new` differs from `create` in that it always starts from an
 *  empty item list instead of the schedule currently open, and can load
 *  itself into the schedule right after saving (`openAfter`). */
export function ProgramSidePanel({ mode, onClose, onDirtyChange, onDone, onRequestOpen }: ProgramSidePanelProps) {
  const t = useT();
  const nameInputRef = useRef<HTMLInputElement>(null);
  const isForm = mode.kind === "create" || mode.kind === "new" || mode.kind === "edit" || mode.kind === "duplicate";

  const [initial] = useState(() => initialForm(mode, t));
  const [name, setName] = useState(initial.name);
  const [notes, setNotes] = useState(initial.notes);
  const [favorite, setFavorite] = useState(initial.favorite);
  const [busy, setBusy] = useState(false);
  // `new` only: whether creating also loads the program into the schedule.
  // Defaults on — the common case is creating a program to start loading
  // things into it right away.
  const [openAfter, setOpenAfter] = useState(true);
  // Armed by the first blocked "create and open" attempt over an unsaved
  // schedule (see `handleConfirm`) — the next one goes through regardless.
  // Any further field change disarms it, same spirit as the modal's own
  // discard guard.
  const [confirmArmed, setConfirmArmed] = useState(false);
  const skipDisarmRef = useRef(true);

  const dirty =
    isForm && (name !== initial.name || notes !== initial.notes || favorite !== initial.favorite);

  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    if (skipDisarmRef.current) {
      skipDisarmRef.current = false;
      return;
    }
    setConfirmArmed(false);
  }, [name, notes, favorite, openAfter]);

  const [previewProgram, setPreviewProgram] = useState<ProgramDTO | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState(false);

  useEffect(() => {
    if (isForm) nameInputRef.current?.focus();
  }, [isForm]);

  useEffect(() => {
    if (mode.kind !== "preview") return;
    let cancelled = false;
    setPreviewProgram(null);
    setPreviewError(false);
    setPreviewLoading(true);
    void api.programs
      .load(mode.program.id)
      .then((full) => {
        if (!cancelled) setPreviewProgram(full);
      })
      .catch(() => {
        if (!cancelled) setPreviewError(true);
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mode]);

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      // Stop here so the modal's own document-level Escape listener never
      // sees it — Escape closes the panel first, the modal only on a second
      // press.
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "Enter" || !isForm) return;
    const target = e.target as HTMLElement;
    // A focused button already handles its own Enter (Cancel closes, Save
    // calls handleConfirm below); Notes is multi-line, so Enter there has to
    // stay a plain newline.
    if (target.tagName === "BUTTON" || target.tagName === "TEXTAREA") return;
    if (busy || name.trim().length === 0) return;
    e.preventDefault();
    void handleConfirm();
  }

  async function handleConfirm() {
    setBusy(true);
    try {
      const meta: ProgramMetaInput = { name: name.trim(), notes: notes.trim() || null, favorite };
      if (mode.kind === "create") {
        if (await createProgramFromCurrent(meta)) onDone(mode);
      } else if (mode.kind === "new") {
        if (openAfter && hasUnsavedChanges() && !confirmArmed) {
          setConfirmArmed(true);
          toast.warning(t("programs.discardWarning"));
          return;
        }
        if (await createProgram(meta, openAfter)) onDone(mode, openAfter);
      } else if (mode.kind === "edit") {
        if (await updateProgramMeta(mode.program.id, meta)) onDone(mode);
      } else if (mode.kind === "duplicate") {
        if (await duplicateProgram(mode.program.id, meta)) onDone(mode);
      } else if (mode.kind === "delete") {
        await deleteProgram(mode.program.id);
        onDone(mode);
      } else if (mode.kind === "discard") {
        await openProgram(mode.targetId);
        onDone(mode);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="wa-program-panel-enter flex w-80 shrink-0 flex-col border-l border-border"
      onKeyDown={handleKeyDown}
    >
      {/* `h-13` is shared with the list's search/filter bar in `ProgramsModal`
          so both seams line up when the panel expands the dialog sideways —
          change one and the other has to follow. */}
      <div className="flex h-13 shrink-0 items-center justify-between border-b border-border px-4">
        <Title as="h3" className="min-w-0 truncate">
          {mode.kind === "create"
            ? t("programs.create")
            : mode.kind === "new"
              ? t("programs.new")
              : mode.kind === "edit"
              ? t("programs.edit")
              : mode.kind === "delete"
                ? t("programs.deleteTitle")
                : mode.kind === "duplicate"
                  ? t("programs.duplicateTitle")
                  : mode.kind === "preview"
                    ? mode.program.name
                    : t("programs.discardTitle")}
        </Title>
        <IconButton aria-label={t("common.cancel")} onClick={onClose} size="xs" variant="ghost">
          <Icon name="close" />
        </IconButton>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        {isForm ? (
          <>
            <label className="flex flex-col gap-1">
              <span className="text-sm font-medium text-foreground">{t("programs.name")}</span>
              <Input
                onChange={(e) => setName(e.target.value)}
                placeholder={t("programs.namePlaceholder")}
                ref={nameInputRef}
                value={name}
              />
            </label>
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-foreground">{t("programs.favorite")}</span>
              <Tooltip content={favorite ? t("programs.favoriteRemove") : t("programs.favoriteAdd")} floating>
                <IconButton
                  aria-label={favorite ? t("programs.favoriteRemove") : t("programs.favoriteAdd")}
                  aria-pressed={favorite}
                  onClick={() => setFavorite((v) => !v)}
                  variant="ghost"
                >
                  <Icon className={cn(favorite ? "fill-current text-primary" : "text-subtle")} name="favorite" />
                </IconButton>
              </Tooltip>
            </div>
            <label className="flex flex-col gap-1">
              <span className="text-sm font-medium text-foreground">{t("programs.notes")}</span>
              <textarea
                className="min-h-24 w-full resize-none rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                onChange={(e) => setNotes(e.target.value)}
                placeholder={t("programs.notesPlaceholder")}
                value={notes}
              />
            </label>
            {mode.kind === "new" ? (
              <label className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-foreground">{t("programs.createAndOpen")}</span>
                <Switch checked={openAfter} onChange={(e) => setOpenAfter(e.target.checked)} />
              </label>
            ) : null}
          </>
        ) : mode.kind === "delete" ? (
          <div className="flex flex-col gap-2 text-sm">
            <p className="text-foreground">{t("programs.deleteWarning", { name: mode.program.name })}</p>
            <p className="flex items-start gap-1.5 text-warning">
              <Icon className="mt-0.5 shrink-0" name="alert" />
              <span>{t("programs.itemCount", { count: mode.program.itemCount })}</span>
            </p>
          </div>
        ) : mode.kind === "preview" ? (
          <div className="flex flex-col gap-2">
            <span className="text-xs text-subtle">{t("schedule.itemCount", { count: mode.program.itemCount })}</span>
            {previewLoading ? (
              <div className="flex flex-col gap-1">
                <Skeleton className="h-9" />
                <Skeleton className="h-9" />
                <Skeleton className="h-9" />
              </div>
            ) : previewError ? (
              <Callout tone="danger">{t("programs.loadError")}</Callout>
            ) : previewProgram && previewProgram.items.length > 0 ? (
              <ProgramItemList items={previewProgram.items} />
            ) : (
              <EmptyState icon="folderOpen" title={t("schedule.empty")} />
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-2 text-sm">
            <p className="text-foreground">{t("programs.discardWarning")}</p>
            <p className="text-subtle">{mode.targetName}</p>
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t border-border px-4 py-3">
        <Button className="flex-1" onClick={onClose} variant="ghost">
          {t("common.cancel")}
        </Button>
        {mode.kind === "preview" ? (
          <Button className="flex-1" onClick={() => onRequestOpen(mode.program.id, mode.program.name)} variant="primary">
            {t("common.open")}
          </Button>
        ) : (
          <Button
            className="flex-1"
            disabled={busy || (isForm && name.trim().length === 0)}
            loading={busy}
            onClick={() => void handleConfirm()}
            variant={mode.kind === "delete" ? "danger" : "primary"}
          >
            {mode.kind === "delete"
              ? t("common.delete")
              : mode.kind === "discard"
                ? t("programs.discardConfirm")
                : mode.kind === "duplicate"
                  ? t("programs.duplicate")
                  : mode.kind === "new"
                    ? t("programs.create")
                    : t("common.save")}
          </Button>
        )}
      </div>
    </div>
  );
}
