import type { ComponentProps } from "react";
import { Title } from "@renderer/components/ui";
import { useModalTitleId } from "./modal-title-id";

/** The heading of a modal — a `Title as="h3"` that also carries the id
 *  `Modal` points `aria-labelledby` at, so a screen reader announces WHICH
 *  dialog just opened instead of the bare word "dialog". Use it for the one
 *  heading in a modal's `DialogHeader`; any other heading inside the dialog
 *  stays a plain `Title`. */
export function ModalTitle(props: Omit<ComponentProps<typeof Title>, "as" | "id">) {
  return <Title as="h3" id={useModalTitleId() ?? undefined} {...props} />;
}
