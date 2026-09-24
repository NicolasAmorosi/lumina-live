import { useT } from "@renderer/lib/i18n/i18n-provider";
import { Icon, IconButton, Tooltip } from "@renderer/components/ui";
import { cn } from "@renderer/lib/utils";
import type { MediaSourceView } from "@renderer/stores/library.store";

type MediaSourceBarProps = {
  activeView: MediaSourceView;
  folders: readonly string[];
  onAddFolder: () => void;
  onRemoveFolder: (folderPath: string) => void;
  onSelectView: (view: MediaSourceView) => void;
};

const baseButton =
  "min-w-0 shrink-0 truncate rounded-md border px-2 py-1 text-left text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const activeButton = "border-border bg-surface text-primary-ink";
const inactiveButton = "border-transparent bg-muted/50 text-subtle hover:bg-hover hover:text-foreground";

/**
 * Sits above a resource kind's asset grid: a small "recent" toggle plus one
 * button per linked folder (each showing its path, widest when there is only
 * one), and a trailing button to link another. Folder buttons never proxy a
 * destructive action by themselves — unlinking needs the hover "x".
 */
export function MediaSourceBar({ activeView, folders, onAddFolder, onRemoveFolder, onSelectView }: MediaSourceBarProps) {
  const t = useT();

  return (
    <div className="flex shrink-0 items-center gap-1 border-b border-border px-1.5 py-1">
      <button
        className={cn(baseButton, "shrink-0", activeView === "recent" ? activeButton : inactiveButton)}
        onClick={() => onSelectView("recent")}
        type="button"
      >
        {t("resources.recentTab")}
      </button>

      {folders.map((folderPath) => (
        <div className="group/folder min-w-0 flex-1" key={folderPath}>
          <div className="relative">
            <Tooltip className="block w-full min-w-0" content={folderPath} fit="path" floating>
              <button
                className={cn(baseButton, "flex w-full items-center gap-1 pr-5", activeView === folderPath ? activeButton : inactiveButton)}
                onClick={() => onSelectView(folderPath)}
                type="button"
              >
                <Icon className="shrink-0 size-3" name="folder" />
                {/* `dir="rtl"` + `text-align: left` makes the ellipsis eat the
                 *  start of the path instead of the end — the tail (file/folder
                 *  name) is what tells two similar paths apart, not the shared
                 *  prefix. */}
                <span className="min-w-0 flex-1 overflow-hidden text-left whitespace-nowrap text-ellipsis" dir="rtl">
                  {folderPath}
                </span>
              </button>
            </Tooltip>
            <Tooltip
              align="end"
              className="absolute top-1/2 right-0.5 z-[var(--z-sticky)] hidden -translate-y-1/2 group-hover/folder:inline-flex"
              content={t("resources.removeFolderHint")}
              placement="bottom"
            >
              <IconButton
                aria-label={t("resources.removeFolder")}
                onClick={() => onRemoveFolder(folderPath)}
                size="xs"
                variant="ghost"
              >
                <Icon className="size-3" name="close" />
              </IconButton>
            </Tooltip>
          </div>
        </div>
      ))}

      <Tooltip align="end" className="ml-auto shrink-0" content={t("resources.addFolderHint")} placement="bottom">
        <IconButton aria-label={t("resources.addFolder")} onClick={onAddFolder} size="xs" variant="ghost">
          <Icon name="folderPlus" />
        </IconButton>
      </Tooltip>
    </div>
  );
}
