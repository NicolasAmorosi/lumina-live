import type { HTMLAttributes } from "react";
import { cn } from "@renderer/lib/utils";

export type BadgeVariant = "blue" | "neutral" | "danger" | "ppt" | "video" | "image" | "audio" | "bible";

const variants: Record<BadgeVariant, string> = {
  blue: "bg-primary/15 text-primary",
  neutral: "bg-muted text-muted-foreground",
  danger: "bg-danger/15 text-danger",
  ppt: "bg-badge-ppt/20 text-badge-ppt",
  video: "bg-badge-video/20 text-badge-video",
  image: "bg-badge-image/20 text-badge-image",
  audio: "bg-badge-audio/20 text-badge-audio",
  bible: "bg-badge-bible/20 text-badge-bible",
};

type BadgeProps = HTMLAttributes<HTMLSpanElement> & { variant?: BadgeVariant };

export function Badge({ className, variant = "neutral", ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}
