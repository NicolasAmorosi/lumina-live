import { useEffect, useId, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@renderer/lib/utils";
import { Dialog } from "@renderer/components/ui";
import { isTopModal, popModal, pushModal, subscribeModalStack } from "./modal-stack";

type ModalSize = "sm" | "md" | "lg" | "xl" | "2xl";
const modalSizes: Record<ModalSize, string> = {
  sm: "max-w-md",
  md: "max-w-lg",
  lg: "max-w-2xl",
  xl: "max-w-4xl",
  "2xl": "max-w-5xl",
};

type ModalHeight = "auto" | "tall";
/** "tall" gives a modal a large, fixed height instead of growing to its
 *  content — for a multi-section screen (e.g. Settings) where switching
 *  section must not resize the dialog. Still capped by the viewport. */
const modalHeights: Record<ModalHeight, string> = {
  auto: "",
  tall: "h-[min(44rem,calc(100dvh-2rem))]",
};

type ModalProps = {
  children: ReactNode;
  className?: string;
  closeOnOverlay?: boolean;
  height?: ModalHeight;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  size?: ModalSize;
};

/**
 * Only the top modal in the stack paints a backdrop, so stacking a confirm
 * dialog over a form modal doesn't double-darken the screen. Uses
 * useSyncExternalStore purely as a hydration-safe way to read the module-level
 * stack — there's no server render here, but the pattern (and modal-stack.ts)
 * is copied verbatim from libretto-villaaurora for consistency.
 */
export function Modal({
  children,
  className,
  closeOnOverlay = true,
  height = "auto",
  onOpenChange,
  open,
  size = "md",
}: ModalProps) {
  const id = useId();
  const topId = useSyncExternalStore(subscribeModalStack, () => (isTopModal(id) ? id : null));

  useEffect(() => {
    if (!open) return;
    pushModal(id);
    return () => popModal(id);
  }, [open, id]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && topId === id) onOpenChange(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, topId, id, onOpenChange]);

  if (!open) return null;
  const isTop = topId === id;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {isTop ? (
        <button
          aria-hidden="true"
          className="absolute inset-0 cursor-default bg-black/60 backdrop-blur-sm"
          onClick={() => closeOnOverlay && onOpenChange(false)}
          tabIndex={-1}
          type="button"
        />
      ) : null}
      <Dialog
        className={cn(
          "relative max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)]",
          modalSizes[size],
          modalHeights[height],
          className,
        )}
        tabIndex={-1}
      >
        {children}
      </Dialog>
    </div>,
    document.body,
  );
}
