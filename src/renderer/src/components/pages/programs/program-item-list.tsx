import { useLayoutEffect, useRef, useState } from "react";
import { Badge, Icon, ListRow, Tooltip } from "@renderer/components/ui";
import { useItemIconAndBadge, useItemLabel } from "@renderer/lib/hooks/use-program-item-display";
import type { ProgramItemDTO } from "@shared/types/program";

function PreviewItemRow({ item }: { item: ProgramItemDTO }) {
  const label = useItemLabel(item);
  const { icon, badge } = useItemIconAndBadge(item);
  const labelRef = useRef<HTMLSpanElement>(null);
  const [truncated, setTruncated] = useState(false);

  useLayoutEffect(() => {
    const el = labelRef.current;
    if (!el) return;
    setTruncated(el.scrollWidth > el.clientWidth);
  }, [label]);

  const labelSpan = (
    <span className="block w-full min-w-0 truncate" ref={labelRef}>
      {label}
    </span>
  );

  return (
    <ListRow
      className="cursor-default rounded-none px-3"
      leading={
        <Badge className="px-2" variant={badge}>
          <Icon className="size-3.5" name={icon} />
        </Badge>
      }
    >
      {truncated ? (
        <Tooltip className="flex w-full min-w-0" content={label} fit="path" floating>
          {labelSpan}
        </Tooltip>
      ) : (
        labelSpan
      )}
    </ListRow>
  );
}

/** Read-only rendering of a program's items for the side panel's preview
 *  mode — same icon/label logic as the live schedule, but no drag, no
 *  selection, no click handlers. A subtle hover only opens a tooltip when
 *  the title actually overflows and truncates. */
export function ProgramItemList({ items }: { items: ProgramItemDTO[] }) {
  return (
    <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
      {items.map((item) => (
        <PreviewItemRow item={item} key={item.id} />
      ))}
    </ul>
  );
}
