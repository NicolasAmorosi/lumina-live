import type { InputHTMLAttributes } from "react";
import { cn } from "@renderer/lib/utils";

type SliderProps = Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "type" | "value"> & {
  /** How the current value reads beside the track. The default is the number
   *  itself, which is what a percentage or a `cqw` wants; a multiplier
   *  (`1.375`) or a unit belongs here. */
  format?: (value: number) => string;
  /** Accessible name. The visible label lives in the `FieldRow` this sits in,
   *  which is not associated with the input — so without this the control is
   *  announced as an unnamed slider. */
  label: string;
  onChange: (value: number) => void;
  /**
   * How wide the readout is, in `ch`.
   *
   * A fixed box and not content-sized, because the number changes while the
   * thumb is being dragged and a box that resized under it would move the
   * track. But `ch` and not `w-12`: with `tabular-nums`, one `ch` is exactly
   * one digit, so a box sized to the longest string this particular slider can
   * produce carries NO dead space — and dead space inside the item stacks on
   * top of the row's own `gap`, which is what made
   * `.claude/knowledge/fixed-width-readout-inflates-flex-gap.md` a real,
   * measured spacing bug in `MediaTrackRow` and `DeckTransport`. The default
   * fits `100%`, `12.5` and `0.80`; pass 5 for a slider whose values reach
   * `10.25`.
   */
  readoutChars?: number;
  value: number;
};

/**
 * A range with its value read out beside it.
 *
 * The readout is the whole reason this is a primitive rather than a bare
 * `<input type="range">`: a slider with no number is unusable for anything the
 * operator has to reproduce — a text size, a line height, a block width — and
 * the same track-plus-number pair had already been written twice by hand
 * before this existed, which is the point `CLAUDE.md` promotes on.
 *
 * `tabular-nums` and a fixed-width readout so the track does not shift
 * sideways as the number gains a digit while it is being dragged — sized in
 * `ch` rather than in pixels, see `readoutChars`.
 */
export function Slider({ className, format, label, onChange, readoutChars = 4, value, ...rest }: SliderProps) {
  return (
    <>
      <input
        aria-label={label}
        className={cn("w-40 accent-primary disabled:opacity-50", className)}
        onChange={(e) => onChange(Number(e.target.value))}
        type="range"
        value={value}
        {...rest}
      />
      {/* Dimmed with the track: a bright number beside a faded track reads as
          a setting that still applies. */}
      <span
        className={cn("shrink-0 text-right text-xs tabular-nums text-muted-foreground", rest.disabled && "opacity-50")}
        style={{ width: `${readoutChars}ch` }}
      >
        {format ? format(value) : value}
      </span>
    </>
  );
}
