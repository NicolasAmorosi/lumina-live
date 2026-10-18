/**
 * How one picture is replaced by another.
 *
 * Its own module rather than a corner of `projection.ts`, because there are
 * now two unrelated things that fade: the projector moving from one scene to
 * the next (`SceneTransition`), and a time scene crossing from how it reads
 * while it counts to how it reads once it has run out (`SceneEnd.transition`).
 * A `SceneStyle` is dressing, not an output, so pointing it at the output
 * contract to borrow the three words that name a fade would invert the layers
 * for nothing.
 *
 * One list, shared: "the same transitions the screen has" can only stay true
 * if there is exactly one place that says what those are.
 */

/** "none" cuts instantly. "crossfade" fades the new picture in over the old
 *  one without ever going blank; "fade-through-black" fades the old one out
 *  first and the new one in afterwards. */
export const TRANSITION_STYLES = ["none", "crossfade", "fade-through-black"] as const;
export type TransitionStyle = (typeof TRANSITION_STYLES)[number];

/** The ceiling both the settings validator and a scene row are held to. Long
 *  enough for the slowest fade anybody would sit through, short enough that a
 *  bad value cannot leave the projector half-faded for a minute. */
export const TRANSITION_MAX_DURATION_MS = 5_000;

/** A fade, with no say in WHEN it runs — that belongs to whoever owns the
 *  moment: a new `epoch` for the projector, the count reaching zero for a
 *  time scene. */
export type TransitionSpec = { style: TransitionStyle; durationMs: number };
