import { useT, type MessageKey } from "@renderer/lib/i18n/i18n-provider";
import { Icon, IconButton, Input, Menu, Tooltip, type MenuOption } from "@renderer/components/ui";
import { MEDIA_SORT_ORDERS, type MediaSortOrder } from "@shared/types/media";

/** Explicit, because a message key can never be built from a runtime value —
 *  see the note on `MessageKey` in `i18n-provider.tsx`. */
const SORT_LABEL_KEY: Record<MediaSortOrder, MessageKey> = {
  "name-asc": "resources.sortOrders.name-asc",
  "name-desc": "resources.sortOrders.name-desc",
  "date-desc": "resources.sortOrders.date-desc",
  "date-asc": "resources.sortOrders.date-asc",
  "size-desc": "resources.sortOrders.size-desc",
  "size-asc": "resources.sortOrders.size-asc",
};

type MediaFilterBarProps = {
  onQueryChange: (query: string) => void;
  onSortChange: (order: MediaSortOrder) => void;
  query: string;
  sort: MediaSortOrder;
};

/**
 * Under the folder bar: how this view is ordered, and a name filter over it.
 *
 * Both act on what the tab is already showing — the library list or the one
 * linked folder that is open — and neither reaches main. The order is durable
 * (`settings["library.sort"]`, per kind); the query is not, because a filter
 * left over from last week's service is a tab that looks empty for no reason.
 */
export function MediaFilterBar({ onQueryChange, onSortChange, query, sort }: MediaFilterBarProps) {
  const t = useT();

  const options: MenuOption<MediaSortOrder>[] = MEDIA_SORT_ORDERS.map((order) => ({
    label: t(SORT_LABEL_KEY[order]),
    value: order,
  }));

  return (
    <div className="flex shrink-0 items-center gap-1.5 border-b border-border px-1.5 py-1">
      <Tooltip align="start" content={t("resources.sortHint")} placement="bottom">
        <Menu icon="sort" label={t("resources.sort")} onSelect={onSortChange} options={options} value={sort} />
      </Tooltip>

      <div className="min-w-0 flex-1">
        <Input
          aria-label={t("resources.search")}
          icon="search"
          onChange={(e) => onQueryChange(e.target.value)}
          // Escape empties the box instead of reaching the app: a text field
          // already swallows every shortcut while it has focus
          // (`use-global-shortcuts`), so the operator's way out of a filter has
          // to be here.
          onKeyDown={(e) => {
            if (e.key === "Escape" && query !== "") onQueryChange("");
          }}
          placeholder={t("resources.search")}
          size="xs"
          value={query}
        />
      </div>

      {query !== "" ? (
        <Tooltip align="end" content={t("resources.clearSearch")} placement="bottom">
          <IconButton aria-label={t("resources.clearSearch")} onClick={() => onQueryChange("")} size="xs" variant="ghost">
            <Icon className="size-3" name="close" />
          </IconButton>
        </Tooltip>
      ) : null}
    </div>
  );
}
