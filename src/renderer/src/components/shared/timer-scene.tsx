import type { CSSProperties } from "react";
import { cn } from "@renderer/lib/utils";
import { useTimerNow } from "@renderer/lib/hooks/use-timer-now";
import { formatTimerClock, hasReachedZero, pickValueColor } from "@shared/timer";
import { cssFontFamily, cssSceneBackground, type SceneTextStyle, type SceneVerticalAlign } from "@shared/types/scene-style";
import type { ProjectionOutput } from "@shared/types/projection";

export type TimerOutput = Extract<ProjectionOutput, { kind: "timer" }>;

const VERTICAL_ALIGN: Record<SceneVerticalAlign, string> = {
  top: "justify-start pt-[8cqh]",
  middle: "justify-center",
  bottom: "justify-end pb-[8cqh]",
};

/** In `cqw`, like every size here, so the shadow keeps its proportion from a
 *  240px confidence monitor to a 4K projector instead of vanishing on one and
 *  swamping the other. */
const TEXT_SHADOW = "0 0.15cqw 0.6cqw rgba(0,0,0,0.55)";

function textStyle(style: SceneTextStyle, color?: string): CSSProperties {
  return {
    color: color ?? style.color,
    fontSize: `${style.sizeCqw}cqw`,
    fontWeight: style.weight,
    ...(style.shadow ? { textShadow: TEXT_SHADOW } : {}),
  };
}

/**
 * A generated time scene, drawn from an absolute mark.
 *
 * This component is the whole reason the projection window can show a running
 * countdown without anybody pushing it sixty values a minute: the
 * `ProjectionOutput` holds a fixed instant, and the ticking lives here, in the
 * leaf that renders it. Nothing above re-renders per second — not the layer,
 * not `OutputView`, not `ProjectionApp` — so the scene never re-animates and
 * `sceneContentKey` never moves.
 *
 * Three things are decided here rather than upstream, and all three are
 * FORMATTING of the very same mark (see `TimerFormat`): clamping at zero or
 * running into negative numbers, swapping the message for the end message, and
 * the colour triggers. Having the control window decide any of them would mean
 * a clock in the control window and a push at the instant zero passes — which
 * is a full scene transition one minute before the service starts.
 *
 * Rendered by the projector AND by both confidence monitors, through
 * `OutputView`, so what the operator reads is the same number the congregation
 * reads, formatted by the same function.
 */
export function TimerScene({
  onImageError,
  output,
}: {
  onImageError?: ((url: string) => void) | undefined;
  output: TimerOutput;
}) {
  const { backgroundUrl, clock, endMessage, format, style, title } = output;
  const now = useTimerNow(clock, format);

  const value = formatTimerClock(clock, now, format);
  const valueColor = pickValueColor(clock, now, style.value.color, style.triggers);
  // The end message only replaces the normal one once the countdown is at or
  // past zero; a scene without one keeps showing whatever it had.
  const message = (hasReachedZero(clock, now) ? (endMessage ?? output.message) : output.message) ?? null;

  const background = cssSceneBackground(style.background);
  // Narrowed once, rather than re-tested inside the JSX: `background.kind`
  // does not narrow through a boolean.
  const imageBackground = style.background.kind === "image" ? style.background : null;

  return (
    <>
      {background ? <div className="absolute inset-0" style={{ background }} /> : null}

      {imageBackground && backgroundUrl ? (
        <img
          alt=""
          className="absolute inset-0 size-full"
          onError={() => onImageError?.(backgroundUrl)}
          src={backgroundUrl}
          style={{ objectFit: imageBackground.fit }}
        />
      ) : null}

      <div
        className={cn(
          "absolute inset-0 flex flex-col items-center gap-[1.2cqw] px-[6cqw] text-center",
          VERTICAL_ALIGN[style.verticalAlign],
        )}
        style={{ fontFamily: cssFontFamily(style.fontFamily) }}
      >
        {title ? <p style={textStyle(style.title)}>{title}</p> : null}
        {/* `tabular-nums` is not cosmetic: with proportional digits every
            second changes the string's width and the whole number shuffles
            sideways, which on a three-metre screen is the only thing anybody
            looks at. `leading-none` keeps a 20cqw number from reserving half
            the frame in line-height it does not use. */}
        <p className="leading-none tabular-nums" style={textStyle(style.value, valueColor)}>
          {value}
        </p>
        {message ? <p style={textStyle(style.message)}>{message}</p> : null}
      </div>
    </>
  );
}
