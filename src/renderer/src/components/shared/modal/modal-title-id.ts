import { createContext, useContext } from "react";

/** The id `Modal` puts on `aria-labelledby`, handed down so the dialog's own
 *  heading can claim it without every modal threading an id through its
 *  props. Consumed by `ModalTitle`; `null` outside a modal. */
export const ModalTitleIdContext = createContext<string | null>(null);

export function useModalTitleId(): string | null {
  return useContext(ModalTitleIdContext);
}
