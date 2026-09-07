import type { HTMLAttributes } from "react";
import { cn } from "@renderer/lib/utils";

type Tone = "primary" | "success" | "danger";
type ProgressBarProps = HTMLAttributes<HTMLDivElement> & {
  /** 0..1. Values outside the range are clamped. */
  value: number;
  tone?: Tone;
};

const toneClassName: Record<Tone, string> = {
  primary: "bg-primary",
  success: "bg-success",
  danger: "bg-danger",
};

/**
 * Determinate counterpart to `LinearLoader` (which stays for "we don't know
 * the total"). Used by deck conversion progress, the time-to-next-slide bar,
 * and video/audio playback position.
 */
export function ProgressBar({ className, tone = "primary", value, ...props }: ProgressBarProps) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={pct}
      className={cn("h-1 w-full overflow-hidden rounded-full bg-muted", className)}
      role="progressbar"
      {...props}
    >
      <div
        className={cn("h-full rounded-full transition-[width] duration-150", toneClassName[tone])}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
