/**
 * Everything the renderer needs to DRAW a `TransitionSpec` — the stacking and
 * the keyframes on one side, the operator's two dropdowns on the other.
 *
 * Extracted from `output-view.tsx` when a second thing started fading: a time
 * scene crossing into its end state (`TimerScene`). Both are the same picture
 * replacing another picture, so they share one set of keyframes and one set
 * of options; two copies would be two chances for «Crossfade» to mean
 * something slightly different depending on where it was chosen.
 */
import type { CSSProperties } from "react";
import type { SelectOption } from "@renderer/components/ui";
import type { MessageKey, Translate } from "@renderer/lib/i18n/i18n-provider";
import { TRANSITION_STYLES, type TransitionSpec, type TransitionStyle } from "@shared/types/transition";

/** Grace added to a transition's own duration before the outgoing layer is
 *  dropped without having reported `animationend`. Generous on purpose: it is
 *  a safety net for an animation that never ran at all, not a second clock
 *  racing the one that did. */
export const LEAVE_FALLBACK_MARGIN_MS = 400;

/** A layer's part in an in-flight transition. "steady" means no transition is
 *  currently in flight for this element — nothing else is competing with it
 *  for the same pixels, so its z-order doesn't matter and its opacity is
 *  whatever it rests at. */
export type LayerRole = "steady" | "entering" | "leaving";

const LAYER_Z: Record<LayerRole, number> = { leaving: 0, steady: 1, entering: 2 };

const FADE_KEYFRAMES: Record<Exclude<TransitionStyle, "none">, Record<"entering" | "leaving", string>> = {
  crossfade: { entering: "wa-scene-fade-in", leaving: "wa-scene-fade-out" },
  "fade-through-black": { entering: "wa-scene-black-then-in", leaving: "wa-scene-out-then-black" },
};

/** Whether this transition has anything to animate at all. Generic so the
 *  narrowing survives on whatever the caller passed — a `SceneTransition`
 *  stays a `SceneTransition`, `epoch` and all. */
export function isAnimatable<T extends TransitionSpec>(
  transition: T,
): transition is T & { style: Exclude<TransitionStyle, "none"> } {
  return transition.style !== "none" && transition.durationMs > 0;
}

/**
 * Inline style for one side of a transition — a scene layer, the persistent
 * video, or a time scene's text block. `role === "steady"` (or a
 * non-animatable transition) means nothing is in flight: opacity is
 * `restOpacity` directly, no keyframe, no z-index competition. Otherwise it
 * drives the CSS `animation` shorthand (not `transition`): a `transition`
 * property doesn't run when the very same commit that mounts an element also
 * gives it its target value, so an `animation` — which always plays from its
 * own keyframes regardless of when it starts — is what actually fades the
 * very first frame.
 *
 * `held` pauses the animation at its start without changing anything else.
 */
export function transitionStyle(
  role: LayerRole,
  transition: TransitionSpec,
  restOpacity: number,
  held = false,
): CSSProperties {
  if (role === "steady" || !isAnimatable(transition)) {
    return { zIndex: LAYER_Z[role], opacity: restOpacity };
  }
  return {
    zIndex: LAYER_Z[role],
    animationName: FADE_KEYFRAMES[transition.style][role === "entering" ? "entering" : "leaving"],
    animationDuration: `${transition.durationMs}ms`,
    animationTimingFunction: "ease-in-out",
    // Holds the keyframe's start value until the animation actually starts
    // and its end value once it finishes, instead of snapping back to the
    // plain `opacity` this element would otherwise have.
    animationFillMode: "both",
    // Held at its first keyframe until what is entering has something to
    // show — see the video hold in `OutputView`. `fill-mode: both` is what
    // makes a paused start meaningful: the entering side rests at its `from`
    // opacity and the leaving one at full.
    animationPlayState: held ? "paused" : "running",
  };
}

/* -------------------------------------------------------------------------
 * The operator's two dropdowns
 *
 * Shared by Settings → Projection and by a scene's «When the countdown ends»,
 * because the promise made to the operator is literally "the same options the
 * screen has".
 * ---------------------------------------------------------------------- */

const TRANSITION_STYLE_LABEL_KEYS: Record<TransitionStyle, MessageKey> = {
  none: "transition.styles.none",
  crossfade: "transition.styles.crossfade",
  "fade-through-black": "transition.styles.fadeThroughBlack",
};

/** The three durations on offer. A closed list rather than a free number:
 *  nobody can name the difference between 280 ms and 300 ms, and a text field
 *  is one typo away from a five-second fade in the middle of a service. */
const TRANSITION_DURATION_OPTIONS = [150, 300, 600] as const;

export function transitionStyleOptions(t: Translate): SelectOption[] {
  return TRANSITION_STYLES.map((style) => ({ label: t(TRANSITION_STYLE_LABEL_KEYS[style]), value: style }));
}

export function transitionDurationOptions(t: Translate): SelectOption[] {
  return TRANSITION_DURATION_OPTIONS.map((ms) => ({
    label: t(`transition.durations.${ms}`),
    value: String(ms),
  }));
}
