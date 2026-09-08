import type { DragEvent, ReactNode } from "react";
import { cn } from "@renderer/lib/utils";
import { Icon, type IconName } from "./icon";

type ThumbTileProps = {
  className?: string;
  draggable?: boolean;
  /** Fallback shown when there is no `src` and no `media`. */
  icon?: IconName;
  /** 1-based corner number, as EasyWorship numbers its slides. */
  index?: number;
  label?: string;
  /** Replaces the image area entirely (a <video> poster, a text slide…). */
  media?: ReactNode;
  /** Absolutely positioned extras over the media area (a "missing" badge…). */
  overlay?: ReactNode;
  /** Marks the tile that is on the projector right now. */
  live?: boolean;
  onClick?: () => void;
  onDoubleClick?: () => void;
  onDragStart?: (e: DragEvent<HTMLButtonElement>) => void;
  /** The thumbnail failed to load (an evicted slide cache, a moved file). */
  onImageError?: () => void;
  selected?: boolean;
  src?: string | null;
  /** Text-only tile (a scripture verse, a plain-text slide). */
  text?: string;
  title?: string;
};

/**
 * The single tile used by every grid in the app — deck slides, media library
 * entries and scripture verses. Anything that needs a different visual goes in
 * through `media`, so no feature re-implements the frame, the selection ring
 * or the on-air ring.
 */
export function ThumbTile({
  className,
  draggable,
  icon = "file",
  index,
  label,
  live = false,
  media,
  onClick,
  onDoubleClick,
  onDragStart,
  onImageError,
  overlay,
  selected = false,
  src,
  text,
  title,
}: ThumbTileProps) {
  return (
    <button
      aria-current={selected || undefined}
      className={cn(
        "group flex cursor-pointer flex-col overflow-hidden rounded-lg border bg-card text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected ? "border-primary ring-2 ring-primary" : "border-border hover:border-border-light",
        live && !selected && "border-on-air ring-1 ring-on-air",
        className,
      )}
      draggable={draggable}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onDragStart={onDragStart}
      title={title ?? label}
      type="button"
    >
      <span className="relative flex aspect-video w-full items-center justify-center overflow-hidden bg-black">
        {media ??
          (src ? (
            <img
              alt={label ?? ""}
              className="size-full object-contain"
              loading="lazy"
              onError={onImageError}
              src={src}
            />
          ) : text !== undefined ? (
            <span className="line-clamp-5 px-1.5 py-1 text-[0.6875rem] leading-tight text-white/90">
              {text}
            </span>
          ) : (
            <Icon className="size-6 text-subtle" name={icon} />
          ))}
        {index !== undefined ? (
          <span className="absolute top-0.5 left-0.5 rounded bg-background/80 px-1 text-[0.625rem] leading-4 font-semibold text-foreground">
            {index}
          </span>
        ) : null}
        {live ? (
          <span className="absolute top-0.5 right-0.5 size-2 rounded-full bg-on-air shadow-surface" />
        ) : null}
        {overlay}
      </span>
      {label ? (
        <span className="truncate px-1.5 py-1 text-xs text-muted-foreground group-hover:text-foreground">
          {label}
        </span>
      ) : null}
    </button>
  );
}
