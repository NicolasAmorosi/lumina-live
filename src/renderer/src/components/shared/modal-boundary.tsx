import type { ReactNode } from "react";
import { ErrorBoundary } from "./error-boundary";

type ModalBoundaryProps = {
  children: ReactNode;
  /** Whether the modal inside is currently open. Doubles as the reset key:
   *  a boundary that has caught stays caught, so without remounting it on
   *  close the modal would be permanently dead for the rest of the session —
   *  reopening it would render the fallback again. Closing already happens on
   *  every crash (that is what `onCrash` is for), so keying on `open` means
   *  the next open always gets a fresh attempt. */
  open: boolean;
  /** Close this modal and tell the operator. Runs in the commit phase — see
   *  `ErrorBoundary.onError`. */
  onCrash: (error: Error) => void;
};

/**
 * The control window's modals get their own boundary each, not a share of the
 * shell's.
 *
 * The shell boundary replaces what it wraps with a full-panel failure screen.
 * That is the right answer for the workspace itself, and the wrong one for a
 * modal: a throw while rendering the settings dialog would take the order of
 * service, the monitors and every live control down with it, mid-service,
 * over a window the operator opened for ten seconds. Here the modal simply
 * disappears — with a toast saying so — and the shell behind it never notices.
 *
 * The fallback renders nothing on purpose. A modal that failed to render has
 * no partial state worth showing, and `onCrash` has already closed it; an
 * inline error panel would just be a second dead dialog to dismiss.
 */
export function ModalBoundary({ children, onCrash, open }: ModalBoundaryProps) {
  return (
    <ErrorBoundary fallback={() => null} key={String(open)} onError={onCrash}>
      {children}
    </ErrorBoundary>
  );
}
