import { useState, type DragEvent, type Ref } from "react";
import { useT } from "@renderer/lib/i18n/i18n-provider";
import { Badge, Icon, IconButton, ListRow, Tooltip } from "@renderer/components/ui";
import { cn } from "@renderer/lib/utils";
import { hideDragGhost } from "@renderer/lib/dnd";
import type { ProgramSummary } from "@shared/types/program";

type ProgramRowProps = {
  /** Off while the list is filtered — reordering a partial view can't be
   *  mapped back onto the full list, so the grip stays visible but greyed
   *  out and inert instead of disappearing. */
  draggable: boolean;
  /** A drag is hovering this row: the drop indicator goes above it. */
  dragOver: boolean;
  /** This row is the one currently being dragged — faded out in place while
   *  its floating clone (see `ProgramsModal`) does the moving. */
  dragging: boolean;
  isCurrent: boolean;
  onDelete: () => void;
  onDuplicate: () => void;
  onEdit: () => void;
  /** Double click — the fast path straight to the projector's schedule. */
  onOpen: () => void;
  onDragStart: (e: DragEvent<HTMLLIElement>) => void;
  /** Single click — opens the side panel with the program's items and an
   *  explicit "Abrir" confirmation, instead of switching schedules on a
   *  single accidental click. */
  onPreview: () => void;
  onToggleFavorite: () => void;
  program: ProgramSummary;
  ref: Ref<HTMLLIElement>;
  selected: boolean;
};

/** One saved program in the administration list — the only row with action
 *  buttons; the current unsaved schedule gets its own pinned row instead. */
export function ProgramRow({
  draggable,
  dragOver,
  dragging,
  isCurrent,
  onDelete,
  onDragStart,
  onDuplicate,
  onEdit,
  onOpen,
  onPreview,
  onToggleFavorite,
  program,
  ref,
  selected,
}: ProgramRowProps) {
  const t = useT();
  // Native HTML5 drag has no built-in "handle" concept: the row itself must
  // be `draggable`, so it's armed only while the grip is pressed and disarmed
  // right after — everywhere else on the row stays a plain click/double-click.
  const [dragReady, setDragReady] = useState(false);

  return (
    <ListRow
      className={cn("rounded-none px-4 py-1.5", dragging && "opacity-40")}
      data-id={program.id}
      draggable={draggable && dragReady}
      dropBefore={dragOver}
      grip
      gripDisabled={!draggable}
      onGripMouseDown={draggable ? () => setDragReady(true) : undefined}
      onGripMouseUp={draggable ? () => setDragReady(false) : undefined}
      leading={
        <Tooltip content={program.favorite ? t("programs.favoriteRemove") : t("programs.favoriteAdd")} floating>
          <IconButton
            aria-label={program.favorite ? t("programs.favoriteRemove") : t("programs.favoriteAdd")}
            aria-pressed={program.favorite}
            onClick={(e) => {
              e.stopPropagation();
              onToggleFavorite();
            }}
            size="xs"
            variant="ghost"
          >
            <Icon className={cn(program.favorite ? "fill-current text-accent-ink" : "text-subtle")} name="favorite" />
          </IconButton>
        </Tooltip>
      }
      onClick={onPreview}
      onDoubleClick={onOpen}
      onDragEnd={() => setDragReady(false)}
      onDragStart={(e) => {
        hideDragGhost(e);
        onDragStart(e);
      }}
      ref={ref}
      selected={selected}
      trailing={
        <>
          {isCurrent ? <Badge variant="blue">{t("programs.inUse")}</Badge> : null}
          <Tooltip content={t("programs.edit")} floating>
            <IconButton
              aria-label={t("programs.edit")}
              onClick={(e) => {
                e.stopPropagation();
                onEdit();
              }}
              variant="ghost"
            >
              <Icon name="pencil" />
            </IconButton>
          </Tooltip>
          <Tooltip content={t("programs.duplicate")} floating>
            <IconButton
              aria-label={t("programs.duplicate")}
              onClick={(e) => {
                e.stopPropagation();
                onDuplicate();
              }}
              variant="ghost"
            >
              <Icon name="copy" />
            </IconButton>
          </Tooltip>
          <Tooltip content={t("programs.delete")} floating>
            <IconButton
              aria-label={t("programs.delete")}
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              variant="danger"
            >
              <Icon name="remove" />
            </IconButton>
          </Tooltip>
        </>
      }
    >
      {program.name}
    </ListRow>
  );
}
