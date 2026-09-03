import type { HTMLAttributes } from "react";
import { cn } from "@renderer/lib/utils";
import { Icon } from "./icon";

type Tone = "info" | "warning" | "danger";
type CalloutProps = HTMLAttributes<HTMLDivElement> & { tone?: Tone };

const toneClassName: Record<Tone, string> = {
  info: "border-border-light bg-muted text-foreground",
  warning: "border-badge-ppt/40 bg-badge-ppt/10 text-foreground",
  danger: "border-danger/40 bg-danger/10 text-foreground",
};
const toneIcon: Record<Tone, "alert"> = { info: "alert", warning: "alert", danger: "alert" };
const toneIconClassName: Record<Tone, string> = {
  info: "text-primary",
  warning: "text-badge-ppt",
  danger: "text-danger",
};

export function Callout({ children, className, tone = "info", ...props }: CalloutProps) {
  return (
    <div
      className={cn("flex items-start gap-2 rounded-xl border p-3 text-sm", toneClassName[tone], className)}
      {...props}
    >
      <Icon className={cn("mt-0.5 shrink-0", toneIconClassName[tone])} name={toneIcon[tone]} />
      <div>{children}</div>
    </div>
  );
}
