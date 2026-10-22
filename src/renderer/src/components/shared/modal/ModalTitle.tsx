import type { ComponentProps } from "react";
import { Title } from "@renderer/components/ui";
import { cn } from "@renderer/lib/utils";
import { useModalTitleId } from "./modal-title-id";

/** The heading of a modal — a `Title as="h3"` that also carries the id
 *  `Modal` points `aria-labelledby` at, so a screen reader announces WHICH
 *  dialog just opened instead of the bare word "dialog". Use it for the one
 *  heading in a modal's `DialogHeader`; any other heading inside the dialog
 *  stays a plain `Title`. */
export function ModalTitle(props: Omit<ComponentProps<typeof Title>, "as" | "id">) {
  // The identity's display cut, like the panel titles: a dialog is named the
  // way the workspace names its columns. `cn` inside Title lets a caller's
  // className still override it.
  return (
    <Title
      as="h3"
      id={useModalTitleId() ?? undefined}
      {...props}
      className={cn("font-stretch-extra-condensed text-xl font-bold", props.className)}
    />
  );
}
