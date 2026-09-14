import { createPortal } from "react-dom";
import { useT } from "@renderer/lib/i18n/i18n-provider";
import { cn } from "@renderer/lib/utils";
import { useToastStore, type ToastItem, type ToastTone } from "@renderer/stores/toast.store";
import { Icon } from "./icon";
import { IconButton } from "./icon-button";

const toneClassName: Record<ToastTone, string> = {
  info: "border-border-light bg-card text-foreground",
  success: "border-success/40 bg-card text-foreground",
  warning: "border-warning/40 bg-card text-foreground",
  danger: "border-danger/40 bg-card text-foreground",
};
const toneIcon: Record<ToastTone, "check" | "alert"> = {
  info: "alert",
  success: "check",
  warning: "alert",
  danger: "alert",
};
const toneIconClassName: Record<ToastTone, string> = {
  info: "text-primary-ink",
  success: "text-success-ink",
  warning: "text-warning-ink",
  danger: "text-danger-ink",
};

function Toast({ item, onDismiss }: { item: ToastItem; onDismiss: () => void }) {
  const t = useT();
  return (
    <div
      className={cn(
        "wa-toast-enter pointer-events-auto flex items-start gap-2 rounded-xl border p-3 text-sm shadow-overlay",
        toneClassName[item.tone],
      )}
      role="status"
    >
      <Icon className={cn("mt-0.5 shrink-0", toneIconClassName[item.tone])} name={toneIcon[item.tone]} />
      <div className="min-w-0 flex-1">
        <p>{item.message}</p>
        {item.action ? (
          <button
            className="mt-1 text-sm font-medium text-primary-ink hover:underline"
            onClick={() => {
              item.action!.onClick();
              onDismiss();
            }}
            type="button"
          >
            {item.action.label}
          </button>
        ) : null}
      </div>
      <IconButton aria-label={t("common.dismiss")} onClick={onDismiss} size="xs" variant="ghost">
        <Icon name="close" />
      </IconButton>
    </div>
  );
}

/**
 * Mounted once in `App.tsx`. `z-[60]` sits above the `z-50` modal stack so a
 * toast fired from inside a modal is still visible.
 *
 * Portaled to `document.body`, like the modals and for the same reason: a
 * modal marks `#root` `inert` (see `shared/modal/modal-stack.ts`), and a toast
 * rendered inside it would still be readable but its action — "Deshacer",
 * "Eliminar igualmente" — would silently stop being clickable.
 *
 * The container is always mounted, empty or not: a screen reader generally
 * does not announce content inserted into a live region that was created in
 * the same tick, so a host that appears together with its first toast
 * announces nothing at all.
 */
export function ToastHost() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  return createPortal(
    <div
      aria-live="polite"
      className="pointer-events-none fixed bottom-4 left-1/2 z-[60] flex w-full max-w-sm -translate-x-1/2 flex-col gap-2 px-4"
    >
      {toasts.map((item) => (
        <Toast item={item} key={item.id} onDismiss={() => dismiss(item.id)} />
      ))}
    </div>,
    document.body,
  );
}
