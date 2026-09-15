import type { HTMLAttributes } from "react";
import { cn } from "@renderer/lib/utils";
import { Icon } from "./icon";
import { IconButton } from "./icon-button";

type Tone = "info" | "warning" | "danger";
type CalloutProps = HTMLAttributes<HTMLDivElement> & {
  tone?: Tone;
  /** Renders an X on the right that calls this. Omit for the persistent,
   *  accountable states (e.g. deck-conversion failures) that shouldn't be
   *  dismissible — only a transient notice should get one. */
  onDismiss?: () => void;
  /** Required alongside `onDismiss` — always pass a translated label, never a
   *  hardcoded default, per this app's i18n rule. */
  dismissLabel?: string;
};

const toneClassName: Record<Tone, string> = {
  info: "border-border-light bg-muted text-foreground",
  warning: "border-warning/40 bg-warning/10 text-foreground",
  danger: "border-danger/40 bg-danger/10 text-foreground",
};
const toneIcon: Record<Tone, "alert"> = { info: "alert", warning: "alert", danger: "alert" };
const toneIconClassName: Record<Tone, string> = {
  info: "text-primary-ink",
  warning: "text-warning-ink",
  danger: "text-danger-ink",
};

export function Callout({
  children,
  className,
  dismissLabel,
  onDismiss,
  tone = "info",
  ...props
}: CalloutProps) {
  return (
    <div
      className={cn("flex items-start gap-2 rounded-xl border p-3 text-sm", toneClassName[tone], className)}
      {...props}
    >
      <Icon className={cn("mt-0.5 shrink-0", toneIconClassName[tone])} name={toneIcon[tone]} />
      <div className="min-w-0 flex-1 select-text">{children}</div>
      {onDismiss ? (
        <IconButton aria-label={dismissLabel} onClick={onDismiss} size="xs" variant="ghost">
          <Icon name="close" />
        </IconButton>
      ) : null}
    </div>
  );
}
