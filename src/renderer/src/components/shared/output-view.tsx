import { useEffect, useRef, useState, type CSSProperties, type Ref } from "react";
import { Icon } from "@renderer/components/ui";
import { cn } from "@renderer/lib/utils";
import type {
  MediaStatus,
  ProjectionMediaError,
  ProjectionOutput,
  SceneTransition,
  TransitionStyle,
} from "@shared/types/projection";

/** Above this drift (seconds) the LIVE monitor's own video is resynced to the
 *  projector's reported position instead of left to run — see
 *  `LiveVideo`'s drift-correction effect. */
const MONITOR_DRIFT_THRESHOLD_SECONDS = 0.35;

/** Grace added to a transition's own duration before the outgoing layer is
 *  dropped without having reported `animationend`. Generous on purpose: it is
 *  a safety net for an animation that never ran at all, not a second clock
 *  racing the one that did. */
const LEAVE_FALLBACK_MARGIN_MS = 400;

export type OutputViewMode = "live" | "preview" | "monitor";

/** A scene layer's (or the persistent video's) part in an in-flight
 *  transition. "steady" means no transition is currently in flight for this
 *  element — nothing else is competing with it for the same pixels, so its
 *  z-order doesn't matter and its opacity is whatever it rests at. */
type LayerRole = "steady" | "entering" | "leaving";

const LAYER_Z: Record<LayerRole, number> = { leaving: 0, steady: 1, entering: 2 };

const FADE_KEYFRAMES: Record<Exclude<TransitionStyle, "none">, Record<"entering" | "leaving", string>> = {
  crossfade: { entering: "wa-scene-fade-in", leaving: "wa-scene-fade-out" },
  "fade-through-black": { entering: "wa-scene-black-then-in", leaving: "wa-scene-out-then-black" },
};

function isAnimatable(
  transition: SceneTransition,
): transition is SceneTransition & { style: Exclude<TransitionStyle, "none"> } {
  return transition.style !== "none" && transition.durationMs > 0;
}

/**
 * Serializes everything in an output EXCEPT `transition` — used to tell a
 * genuinely new scene from a push that only bumped `sceneEpoch` while
 * showing the exact same thing (an action re-asserting an overlay that was
 * already up, say). `beginScene()` is called from the action layer based on
 * "did the operator do something", not "did the picture actually change" —
 * that distinction is occasionally wrong at the source (an action forcing an
 * overlay it didn't need to), and re-checking it here, once, means a push
 * like that can never animate a scene fading into an identical copy of
 * itself, no matter which action produced it.
 */
function sceneContentKey(output: ProjectionOutput): string {
  return JSON.stringify(output, (key, value) => (key === "transition" ? undefined : value));
}

/**
 * Inline style for one side of a transition — a scene layer or the
 * persistent video. `role === "steady"` (or a non-animatable transition)
 * means nothing is in flight: opacity is `restOpacity` directly, no
 * keyframe, no z-index competition. Otherwise it drives the CSS `animation`
 * shorthand (not `transition`): a `transition` property doesn't run when the
 * very same commit that mounts an element also gives it its target value, so
 * an `animation` — which always plays from its own keyframes regardless of
 * when it starts — is what actually fades the very first frame.
 */
function transitionStyle(role: LayerRole, transition: SceneTransition, restOpacity: number): CSSProperties {
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
  };
}

type LiveVideoProps = {
  /** NEGRO/LOGO is over the video right now. */
  covered: boolean;
  /** This video's identity for its whole mount — see the drift-correction
   *  effect below, which must ignore a `liveVideoStatus` still describing the
   *  previous epoch's video during the instant it takes the projector to
   *  report the new one. */
  epoch: number;
  /** The projector's own video reporting its real position (`mediaStatus`,
   *  keyed "video") — only ever provided for `mode === "monitor"`. Drives the
   *  LIVE monitor's drift correction; unused for "live"/"preview". */
  liveVideoStatus?: MediaStatus | null | undefined;
  mode: OutputViewMode;
  /** This element failed to load or decode. `code` is
   *  `HTMLMediaElement.error.code`, which is the only reason the browser
   *  gives — not a message. */
  onError: (code: number | null) => void;
  /** Declarative, operator-controlled pause from the media panel — distinct
   *  from `covered`, and deliberately takes priority: an explicit pause must
   *  survive a NEGRO/LOGO round-trip instead of being silently overridden by
   *  it when the overlay comes back off. */
  paused: boolean;
  /** This element's part in whatever transition is currently in flight (or
   *  "steady" when there isn't one) — see `OutputView`'s `videoRole`. */
  role: LayerRole;
  /** Point the operator chose on the preview scrubber before EN VIVO. Applied
   *  once, right when this element mounts — never re-applied later, so a
   *  scrub from the media panel afterwards isn't fought on the next render. */
  startAtSeconds: number;
  transition: SceneTransition;
  url: string;
  videoRef?: Ref<HTMLVideoElement> | undefined;
};

/**
 * The projector's video element. Kept mounted for as long as the *base* content
 * is this video — NEGRO/LOGO only covers it — because tearing the element down
 * and rebuilding it on every overlay toggle churns Chromium's media pipeline
 * for nothing.
 *
 * Covering it pauses it and holds its position, rather than letting it run on
 * unseen: the operator expects NEGRO to stop the video. A deck's own
 * soundtrack (`ProjectionApp`) now follows the same rule; only a standalone
 * audio asset sent live is meant to keep playing through an overlay.
 *
 * Hidden by `opacity` (via `transitionStyle`), not `display:none`: it's the
 * one element that survives across scenes, so covering/uncovering it is
 * itself a transition (fading a scene layer in over it, or fading it back in
 * over a scene layer) rather than an instant toggle. `role`/`transition` come
 * from `OutputView`, which is the only place that knows which side of an
 * in-flight transition (if any) this video is currently on.
 *
 * "monitor" (the LIVE confidence monitor) plays a second, independently
 * decoding instance of the same file, muted — it is a separate `<video>` in
 * the control window's own renderer process (Electron gives each
 * `BrowserWindow` its own process; a decoder can't be shared across that
 * boundary), so it free-runs on its own clock and can drift from the
 * projector's from decode-timing jitter alone. The drift-correction effect
 * below periodically snaps it back to the projector's real position
 * (`liveVideoStatus`, sourced from the same `mediaStatus` the transport bar
 * already reads) — play/pause need no such correction since both elements
 * derive `paused` from the same declarative store field in the same render.
 */
function LiveVideo({
  covered,
  epoch,
  liveVideoStatus,
  mode,
  onError,
  paused,
  role,
  startAtSeconds,
  transition,
  url,
  videoRef,
}: LiveVideoProps) {
  const elementRef = useRef<HTMLVideoElement | null>(null);
  const shouldPlay = !covered && !paused;

  function attach(element: HTMLVideoElement | null) {
    elementRef.current = element;
    // Belt-and-suspenders alongside the `muted` attribute below: an explicit
    // `volume = 0` on every non-"live" mode means a future mode that forgets
    // to check `muted` still can't make this element audible.
    if (element && mode !== "live") element.volume = 0;
    if (typeof videoRef === "function") videoRef(element);
    else if (videoRef) (videoRef as { current: HTMLVideoElement | null }).current = element;
  }

  // `autoPlay` only applies to a freshly loaded element, so every transition —
  // NEGRO/LOGO, and an operator pause/resume from the media panel — has to be
  // driven imperatively.
  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    if (shouldPlay) element.play().catch(() => undefined);
    else element.pause();
  }, [shouldPlay]);

  // Resyncs the LIVE monitor's independently decoding video to the
  // projector's real position whenever a fresh `mediaStatus` report arrives
  // (~4x/second) and drifts past the threshold — this is also what makes a
  // manual seek/restart from the media panel reach this element: it isn't
  // routed here directly, it just shows up as a jump in `liveVideoStatus` on
  // the next report and gets corrected like any other drift. Guarded by
  // `epoch` so a status report still describing the previous video (the
  // instant before the projector reports the new one) is never applied here.
  useEffect(() => {
    if (mode !== "monitor" || !liveVideoStatus || liveVideoStatus.epoch !== epoch) return;
    const element = elementRef.current;
    if (!element) return;
    const drift = Math.abs(element.currentTime - liveVideoStatus.currentTimeSeconds);
    if (drift > MONITOR_DRIFT_THRESHOLD_SECONDS) {
      element.currentTime = liveVideoStatus.currentTimeSeconds;
    }
  }, [mode, liveVideoStatus, epoch]);

  // The component is keyed by epoch at the call site, so this instance only
  // ever has one `startAtSeconds` for its whole lifetime — applying it once,
  // on mount, is correct without watching for later changes.
  useEffect(() => {
    const element = elementRef.current;
    if (!element || startAtSeconds <= 0) return;
    const apply = () => {
      element.currentTime = startAtSeconds;
    };
    if (element.readyState >= 1) apply();
    else element.addEventListener("loadedmetadata", apply, { once: true });
    return () => element.removeEventListener("loadedmetadata", apply);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <video
      autoPlay={shouldPlay}
      className="absolute inset-0 size-full object-contain"
      // Whitelist, not a check against "monitor": any future mode is muted
      // by default and only the real projector ever gets sound.
      muted={mode !== "live"}
      onError={(event) => onError(event.currentTarget.error?.code ?? null)}
      preload="metadata"
      ref={attach}
      src={url}
      style={transitionStyle(role, transition, covered ? 0 : 1)}
    />
  );
}

type OutputSceneProps = {
  mode: OutputViewMode;
  /** The still image of this scene could not be loaded. Only ever wired for
   *  the *top* layer (see `OutputView`): an outgoing layer failing on its way
   *  out describes content nobody is looking at any more. */
  onImageError?: ((url: string) => void) | undefined;
  output: ProjectionOutput;
};

/**
 * The non-video content of one `ProjectionOutput` — everything a scene layer
 * paints. Split out from `OutputView` so a layer's markup is identical
 * whether it's the sole steady scene or one half of a transition; `black`
 * and `video` themselves render nothing here (black is the layer's own
 * background — see `SceneLayer` — and video is the persistent element
 * `OutputView` renders outside every layer).
 */
function OutputScene({ mode, onImageError, output }: OutputSceneProps) {
  return (
    <>
      {(output.kind === "logo" && output.url) || output.kind === "image" ? (
        <img
          alt=""
          className="size-full object-contain"
          onError={() => {
            if (output.url) onImageError?.(output.url);
          }}
          src={output.url ?? undefined}
        />
      ) : null}

      {/* No `key` here either — swapping `src` within the same layer (same
          `seq`, see `OutputView`) on slide navigation is what avoids the
          white flash between slides. */}
      {output.kind === "slide" ? (
        <img
          alt=""
          className="size-full object-contain"
          decoding={mode === "live" ? "sync" : "async"}
          onError={() => onImageError?.(output.url)}
          src={output.url}
        />
      ) : null}

      {output.kind === "bible" ? (
        <div
          className="flex flex-col items-center gap-[2cqw] px-[6cqw] text-center"
          style={{ textShadow: "0 2px 8px rgba(0,0,0,0.8)" }}
        >
          <p className="text-[3.5cqw] leading-snug font-light">{output.text}</p>
          <p className="text-[2cqw] font-semibold">{output.reference}</p>
        </div>
      ) : null}

      {output.kind === "text" ? (
        <p
          className="px-[6cqw] text-center text-[4cqw] leading-snug"
          style={{ textShadow: "0 2px 8px rgba(0,0,0,0.8)" }}
        >
          {output.body}
        </p>
      ) : null}
    </>
  );
}

type SceneLayerProps = {
  mode: OutputViewMode;
  onImageError?: ((url: string) => void) | undefined;
  onLeaveComplete?: (() => void) | undefined;
  output: ProjectionOutput;
  role: LayerRole;
  transition: SceneTransition;
};

/** One stacked scene — `OutputView` mounts up to two at once (the outgoing
 *  and incoming side of a transition) or just one at rest. `opaque` is what
 *  makes "black" and a logo-less LOGO actually look black/blank: those kinds
 *  paint nothing in `OutputScene`, so the layer's own background does it —
 *  except for `video`, which paints nothing here on purpose (see
 *  `OutputScene`) and must stay transparent so the persistent `<video>`
 *  element shows through instead of being hidden behind an opaque box. */
function SceneLayer({ mode, onImageError, onLeaveComplete, output, role, transition }: SceneLayerProps) {
  const opaque = output.kind !== "video";
  return (
    <div
      className={cn("absolute inset-0 flex items-center justify-center", opaque && "bg-black")}
      onAnimationEnd={(e) => {
        if (e.target === e.currentTarget && role === "leaving") onLeaveComplete?.();
      }}
      style={transitionStyle(role, transition, 1)}
    >
      <OutputScene mode={mode} onImageError={onImageError} output={output} />
    </div>
  );
}

type OutputErrorNoticeProps = { label: string };

/**
 * The band the LIVE and PREVIEW monitors paint over the stage when what they
 * are showing failed to load. Never painted on the projector itself
 * (`mode === "live"` in `OutputView`) — the congregation must not see the
 * warning, only the operator.
 *
 * Sized in `cqw` like everything else here so it reads the same on a 240px
 * monitor as it would at 4K, and anchored to the bottom so it never covers
 * the middle of the frame — the operator still sees whatever *did* manage to
 * render underneath it.
 */
function OutputErrorNotice({ label }: OutputErrorNoticeProps) {
  return (
    <div
      className="absolute inset-x-0 bottom-0 z-10 flex items-center justify-center gap-[1.5cqw] bg-danger/90 px-[3cqw] py-[1.6cqw] text-center text-[3cqw] leading-tight font-semibold text-white"
      role="status"
    >
      <Icon className="size-[3.5cqw] shrink-0" name="alert" />
      <span className="min-w-0">{label}</span>
    </div>
  );
}

type OutputViewProps = {
  className?: string;
  /** Translated one-line notice to paint over the stage when what's showing
   *  failed to load. Passed in rather than built here so this component stays
   *  free of i18n — it also renders inside the projection window, which has
   *  no provider. Omit it (the projector does) and no notice is ever shown. */
  errorLabel?: string;
  /**
   * "live" is the projection window itself: video autoplays and is wired to
   * the media refs, with sound. "preview" is the operator's preview monitor:
   * same pixels, muted, but a video CAN play there under the operator's own
   * play button (see `preview-media-bar.tsx`) — never automatically. "monitor"
   * is the LIVE confidence monitor — same pixels, muted, and autoplaying in
   * lockstep with the projector (see `liveVideoStatus`).
   */
  /** The projector's own video `mediaStatus` — only meaningful (and only ever
   *  passed) for `mode === "monitor"`; drives `LiveVideo`'s drift correction. */
  liveVideoStatus?: MediaStatus | null;
  mode: OutputViewMode;
  /** One of this view's own elements failed. The projection window forwards
   *  it to main (`projection:reportMediaError`); the monitors don't need to —
   *  a local failure already shows up in this view's own notice. */
  onMediaError?: (error: ProjectionMediaError) => void;
  output: ProjectionOutput;
  /** Urls the *projector* reported as failed. What makes the LIVE monitor's
   *  notice describe the projector rather than its own second, independently
   *  decoding copy of the same file — the monitor may well be able to play
   *  something the projector can't, and vice versa. */
  reportedErrorUrls?: readonly string[];
  videoRef?: Ref<HTMLVideoElement>;
};

/** One stacked scene, keyed by a local sequence number — NOT by
 *  `output.transition.epoch` directly, so a rapid run of scene changes never
 *  produces key gaps or reuses a stale one. */
type Layer = { seq: number; output: ProjectionOutput };

/** Drops the outgoing half of a finished transition, leaving one "steady"
 *  layer (`role` is derived from `layers.length`, so this is also what takes
 *  the survivor off its keyframe and back to a plain opacity). Module-level so
 *  both callers — `animationend` and its fallback timer — share one definition
 *  without either becoming an effect dependency. */
function withoutOutgoing(layers: Layer[], seq: number): Layer[] {
  return layers.length > 1 && layers[0]?.seq === seq ? layers.slice(1) : layers;
}

/**
 * Renders a `ProjectionOutput`. The projection window and both confidence
 * monitors (live + preview) all go through this one component, so what the
 * operator sees in a monitor cannot drift from what the congregation sees.
 *
 * Type sizes are in `cqw`, not `vw`: the root is a container, so the exact same
 * markup scales from a 240px monitor to a 4K projector with no per-size
 * variants. Video/image/slide media scale the same way, but by `object-contain`
 * on a `size-full` element rather than by type size: a source smaller than the
 * output (a 360p video, say) is stretched up to fill it — never left at native
 * size — while keeping its aspect ratio, so a monitor never shows content
 * smaller, relative to its box, than the projector shows it.
 *
 * ## Scene transitions
 *
 * `output.transition.epoch` only advances when the control window begins a
 * genuinely new scene (`beginScene()` in `projection.store.ts`) — never for
 * navigating within what's already live (a slide, a verse). That's the
 * signal this component watches: an unchanged epoch always updates the
 * current layer in place (an un-keyed `src`/content swap, same as before
 * transitions existed at all — critical for the slide anti-flash comment
 * above), while a changed epoch retains the previous scene as an "outgoing"
 * layer under a fresh "incoming" one and fades between them per
 * `output.transition.style`/`durationMs`. At most two layers ever exist —
 * a transition that arrives mid-flight drops the older one immediately
 * rather than growing a queue.
 *
 * The persistent `<video>` (kept mounted independent of any layer — see
 * `LiveVideo`) participates in the same fade: covering/uncovering it with
 * NEGRO/LOGO is a real transition between "the video" and "an opaque scene",
 * so it needs to know which side of the current transition (if any) it's on
 * — see `videoRole` below. What it can't do is fade OUT as a video changes
 * to a different kind of content: the moment `base` stops being that video,
 * `videoUnderlay` goes `null` and the element unmounts in the same push that
 * starts the new scene (re-keying/remounting a live video is what produces
 * `PIPELINE_ERROR_DECODE` — see `.claude/knowledge/
 * worship-protocol-range-and-video-lifecycle.md`). That case still fades —
 * the new content fades in from black — it just can't fade the video's own
 * pixels out first.
 *
 * `mode === "preview"` never animates (`shouldAnimate`): the preview monitor
 * moves with every ↑/↓ and would feel laggy if it did.
 */
export function OutputView({
  className,
  errorLabel,
  liveVideoStatus,
  mode,
  onMediaError,
  output,
  reportedErrorUrls,
  videoRef,
}: OutputViewProps) {
  // Warm the neighbouring slides so a change never waits on a decode. Plain
  // Image objects rather than hidden DOM nodes: no layout, no paint, and
  // nothing stray in the render tree. Only the real projector needs this.
  //
  // The current slide's own url leads the list: it is not warmed for its own
  // sake (the visible `<img>` is already fetching it) but so the set below can
  // tell "still wanted" from "abandoned" without a second source of truth.
  const preloadKey =
    mode === "live" && output.kind === "slide" ? [output.url, ...output.preload].join("|") : "";
  const warmedRef = useRef(new Map<string, HTMLImageElement>());
  useEffect(() => {
    const wanted = preloadKey ? preloadKey.split("|") : [];
    const keep = new Set(wanted);
    const warmed = warmedRef.current;

    // Abandon what this position no longer wants. Assigning `src = ""` is what
    // actually aborts an image fetch that is still in flight — dropping the
    // reference does not, so navigating quickly through a long deck used to
    // leave dozens of downloads running, competing for bandwidth and decode
    // time with the one slide the operator is actually waiting for. An image
    // that already finished is simply forgotten: it is in Chromium's cache
    // (slide urls are served `immutable`), so re-warming it later is free.
    for (const [url, img] of warmed) {
      if (keep.has(url)) continue;
      if (!img.complete) img.src = "";
      warmed.delete(url);
    }

    for (const url of wanted) {
      if (warmed.has(url)) continue;
      const img = new Image();
      img.decoding = "async";
      img.src = url;
      warmed.set(url, img);
    }
  }, [preloadKey]);

  // Unmount: nothing is wanted any more, in flight or not.
  useEffect(() => {
    const warmed = warmedRef.current;
    return () => {
      for (const img of warmed.values()) {
        if (!img.complete) img.src = "";
      }
      warmed.clear();
    };
  }, []);

  const shouldAnimate = mode !== "preview";

  const seqRef = useRef(0);
  const topRef = useRef<Layer>({ seq: 0, output });
  const lastEpochRef = useRef(output.transition.epoch);
  const leaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [layers, setLayers] = useState<Layer[]>(() => [topRef.current]);
  const [transition, setTransition] = useState<SceneTransition>(output.transition);

  useEffect(() => {
    const sameEpoch = lastEpochRef.current === output.transition.epoch;
    lastEpochRef.current = output.transition.epoch;
    const sameContent = sceneContentKey(topRef.current.output) === sceneContentKey(output);

    if (!shouldAnimate || sameEpoch || sameContent || !isAnimatable(output.transition)) {
      // Content-only refresh: same layer, same key, no animation. This is
      // what keeps navigating within a live deck/verse, a pause toggle, or
      // an overlay's own `covered` prop an instant, un-keyed swap — exactly
      // like before transitions existed. `sameContent` catches the case a
      // changed epoch alone can't: an action that begins a new scene without
      // the picture actually changing (see `sceneContentKey`).
      const nextTop = { seq: topRef.current.seq, output };
      topRef.current = nextTop;
      // Any in-flight transition is over by definition — this collapses to a
      // single layer, so its fallback has nothing left to drop.
      if (leaveTimerRef.current !== null) {
        clearTimeout(leaveTimerRef.current);
        leaveTimerRef.current = null;
      }
      setLayers([nextTop]);
      return;
    }

    // A genuinely new scene: the current top becomes the outgoing layer, a
    // fresh one enters on top of it. Only two layers are ever kept — a
    // transition that arrives mid-flight replaces the pair outright (the
    // older of the two is dropped without waiting for its own animation),
    // rather than growing a queue.
    const outgoing = topRef.current;
    seqRef.current += 1;
    const incoming: Layer = { seq: seqRef.current, output };
    topRef.current = incoming;
    setTransition(output.transition);
    setLayers([outgoing, incoming]);

    // The fallback that makes `animationend` optional. It never arrives if the
    // animation never ran — and an Electron window that is occluded (fully
    // covered by another window, or on a display that went to sleep) has no
    // rendering lifecycle at all, so no animation frames and no `animationend`;
    // see `.claude/knowledge/occluded-electron-window-has-no-rendering-lifecycle.md`.
    // Left alone, `animation-fill-mode: both` pins the incoming layer at its
    // keyframe's *start* — opacity 0 — with the outgoing one still painting at
    // full opacity underneath: the projector simply stops changing, which is
    // the worst symptom this component can produce.
    if (leaveTimerRef.current !== null) clearTimeout(leaveTimerRef.current);
    leaveTimerRef.current = setTimeout(() => {
      leaveTimerRef.current = null;
      setLayers((prev) => withoutOutgoing(prev, outgoing.seq));
    }, output.transition.durationMs + LEAVE_FALLBACK_MARGIN_MS);
  }, [output, shouldAnimate]);

  // Unmount only — deliberately not the effect above's cleanup, which runs on
  // every single output push and would cancel the fallback for a transition
  // that is still perfectly in flight.
  useEffect(
    () => () => {
      if (leaveTimerRef.current !== null) clearTimeout(leaveTimerRef.current);
    },
    [],
  );

  function handleLeaveComplete(seq: number) {
    if (leaveTimerRef.current !== null) {
      clearTimeout(leaveTimerRef.current);
      leaveTimerRef.current = null;
    }
    setLayers((prev) => withoutOutgoing(prev, seq));
  }

  // One slot each, holding the url that last failed — never a growing set.
  // A single scene and a single video are on screen at a time, and the notice
  // below only fires when the slot still matches what is showing, so a slot
  // overwritten by a later failure is exactly a slot that stopped mattering.
  // This is also why nothing ever has to clear them.
  const [failedSceneUrl, setFailedSceneUrl] = useState<string | null>(null);
  const [failedVideoUrl, setFailedVideoUrl] = useState<string | null>(null);

  function handleImageError(url: string) {
    setFailedSceneUrl(url);
    onMediaError?.({ target: { kind: "scene" }, url, code: null });
  }

  function handleVideoError(code: number | null) {
    const url = output.videoUnderlay?.url;
    if (!url) return;
    setFailedVideoUrl(url);
    onMediaError?.({ target: { kind: "video" }, url, code });
  }

  /** A failure is only worth showing while the thing that failed is still the
   *  thing on screen — which is what keeps a warning from outliving its
   *  content without any explicit clearing (see `ProjectionMediaError.url`). */
  function hasFailed(url: string | null | undefined): url is string {
    if (!url) return false;
    return failedSceneUrl === url || failedVideoUrl === url || (reportedErrorUrls?.includes(url) ?? false);
  }

  // The video wins when both could apply: with NEGRO/LOGO over a broken
  // video, "the video won't play" is the fact the operator needs — the
  // overlay itself is fine and is about to come off.
  const videoUnderlayUrl = output.videoUnderlay?.url ?? null;
  const sceneUrl =
    output.kind === "image" || output.kind === "slide" || output.kind === "logo" ? output.url : null;
  // `mode !== "live"` is belt-and-suspenders on top of the projector simply
  // not passing a label: whatever a future caller does, the congregation
  // never sees this.
  const errorNotice =
    mode !== "live" && errorLabel && (hasFailed(videoUnderlayUrl) || hasFailed(sceneUrl))
      ? errorLabel
      : null;

  // Which side of the current transition (if any) the persistent video is
  // on. Only meaningful while two layers are stacked; with a single steady
  // layer nothing competes with the video for the same pixels.
  const videoRole: LayerRole =
    layers.length < 2
      ? "steady"
      : layers[0]?.output.kind === "video"
        ? "leaving"
        : layers[1]?.output.kind === "video"
          ? "entering"
          : "steady";

  return (
    <div
      className={cn(
        "@container relative size-full overflow-hidden bg-black text-white",
        className,
      )}
    >
      {layers.map((layer, i) => (
        <SceneLayer
          key={layer.seq}
          mode={mode}
          // Top layer only: a layer on its way out failing describes content
          // nobody is looking at any more, and would overwrite the slot that
          // holds the incoming layer's own failure.
          onImageError={i === layers.length - 1 ? handleImageError : undefined}
          onLeaveComplete={i === 0 ? () => handleLeaveComplete(layer.seq) : undefined}
          output={layer.output}
          role={layers.length < 2 ? "steady" : i === 0 ? "leaving" : "entering"}
          transition={transition}
        />
      ))}

      {/* Always the last sibling: painted after every scene layer, and its
          own z-index (via `videoRole`) settles who's on top whenever it's
          actually competing with a layer for the same pixels. */}
      {output.videoUnderlay ? (
        <LiveVideo
          covered={output.kind !== "video"}
          epoch={output.videoUnderlay.epoch}
          key={output.videoUnderlay.epoch}
          liveVideoStatus={liveVideoStatus}
          mode={mode}
          onError={handleVideoError}
          paused={output.videoUnderlay.paused}
          role={videoRole}
          startAtSeconds={output.videoUnderlay.startAtSeconds}
          transition={transition}
          url={output.videoUnderlay.url}
          videoRef={videoRef}
        />
      ) : null}

      {/* Last of all, above every layer and the video: the operator has to be
          able to read it whatever is (or isn't) painting underneath. */}
      {errorNotice ? <OutputErrorNotice label={errorNotice} /> : null}
    </div>
  );
}
