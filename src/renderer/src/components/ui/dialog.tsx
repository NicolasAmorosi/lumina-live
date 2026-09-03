import type { HTMLAttributes, Ref } from "react";
import { cn } from "@renderer/lib/utils";

type DialogProps = HTMLAttributes<HTMLDivElement> & { ref?: Ref<HTMLDivElement> };

export function Dialog({ className, ref, ...props }: DialogProps) {
  return (
    <div
      className={cn("flex flex-col rounded-xl border border-border bg-card shadow-overlay outline-none", className)}
      ref={ref}
      role="dialog"
      {...props}
    />
  );
}

export function DialogHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex items-center justify-between border-b border-border px-4 py-3", className)} {...props} />;
}

export function DialogContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex-1 overflow-y-auto px-4 py-3", className)} {...props} />;
}

export function DialogFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex items-center justify-end gap-2 border-t border-border px-4 py-3", className)} {...props} />;
}
