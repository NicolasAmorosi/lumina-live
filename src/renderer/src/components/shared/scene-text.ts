import type { CSSProperties } from "react";
import type { SceneTextStyle } from "@shared/types/scene-style";

/** In `cqw`, like every size on the stage, so the shadow keeps its proportion
 *  from a 240px confidence monitor to a 4K projector instead of vanishing on
 *  one and swamping the other. One formula for every generated scene — the
 *  time scenes, the verse and the plates — because it is the same shadow doing
 *  the same job over the same kinds of background.
 *
 *  The strength darkens it and spreads it together, scaled so that
 *  `DEFAULT_SHADOW_STRENGTH` (0.55) is exactly the fixed shadow this used to
 *  be: `0 0.15cqw 0.6cqw` at 55% black. */
function textShadow(strength: number): string {
  const offset = (strength * 0.15) / 0.55;
  const blur = (strength * 0.6) / 0.55;
  return `0 ${offset.toFixed(3)}cqw ${blur.toFixed(3)}cqw rgba(0,0,0,${strength})`;
}

/** A `SceneTextStyle` as inline CSS. `color` overrides the style's own (a
 *  countdown's trigger colours). */
export function sceneTextCss(style: SceneTextStyle, color?: string): CSSProperties {
  return {
    color: color ?? style.color,
    fontSize: `${style.sizeCqw}cqw`,
    fontWeight: style.weight,
    ...(style.shadow ? { textShadow: textShadow(style.shadowStrength) } : {}),
  };
}
