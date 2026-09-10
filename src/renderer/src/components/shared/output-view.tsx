import { useEffect, useRef, useState, type CSSProperties, type Ref } from "react";
import { cn } from "@renderer/lib/utils";
import type { MediaStatus, ProjectionOutput, SceneTransition, TransitionStyle } from "@shared/types/projection";

/** Above this drift (seconds) the LIVE monitor's own video is resynced to the
 *  projector's reported position instead of left to run — see
 *  `LiveVideo`'s drift-correction effect. */
const MONITOR_DRIFT_THRESHOLD_SECONDS = 0.35;

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
      preload="metadata"
      ref={attach}
      src={url}
      style={transitionStyle(role, transition, covered ? 0 : 1)}
    />
  );
}

type OutputSceneProps = { mode: OutputViewMode; output: ProjectionOutput };

/**
 * The non-video content of one `ProjectionOutput` — everything a scene layer
 * paints. Split out from `OutputView` so a layer's markup is identical
 * whether it's the sole steady scene or one half of a transition; `black`
 * and `video` themselves render nothing here (black is the layer's own
 * background — see `SceneLayer` — and video is the persistent element
 * `OutputView` renders outside every layer).
 */
function OutputScene({ mode, output }: OutputSceneProps) {
  return (
    <>
      {(output.kind === "logo" && output.url) || output.kind === "image" ? (
        <img alt="" className="size-full object-contain" src={output.url ?? undefined} />
      ) : null}

      {/* No `key` here either — swapping `src` within the same layer (same
          `seq`, see `OutputView`) on slide navigation is what avoids the
          white flash between slides. */}
      {output.kind === "slide" ? (
        <img
          alt=""
          className="size-full object-contain"
          decoding={mode === "live" ? "sync" : "async"}
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
function SceneLayer({ mode, onLeaveComplete, output, role, transition }: SceneLayerProps) {
  const opaque = output.kind !== "video";
  return (
    <div
      className={cn("absolute inset-0 flex items-center justify-center", opaque && "bg-black")}
      onAnimationEnd={(e) => {
        if (e.target === e.currentTarget && role === "leaving") onLeaveComplete?.();
      }}
      style={transitionStyle(role, transition, 1)}
    >
      <OutputScene mode={mode} output={output} />
    </div>
  );
}

type OutputViewProps = {
  className?: string;
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
  output: ProjectionOutput;
  videoRef?: Ref<HTMLVideoElement>;
};

/** One stacked scene, keyed by a local sequence number — NOT by
 *  `output.transition.epoch` directly, so a rapid run of scene changes never
 *  produces key gaps or reuses a stale one. */
type Layer = { seq: number; output: ProjectionOutput };

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
export function OutputView({ className, liveVideoStatus, mode, output, videoRef }: OutputViewProps) {
  // Warm the neighbouring slides so a change never waits on a decode. Plain
  // Image objects rather than hidden DOM nodes: no layout, no paint, and
  // nothing stray in the render tree. Only the real projector needs this.
  const preloadKey = mode === "live" && output.kind === "slide" ? output.preload.join("|") : "";
  useEffect(() => {
    if (!preloadKey) return;
    for (const url of preloadKey.split("|")) {
      const img = new Image();
      img.decoding = "async";
      img.src = url;
    }
  }, [preloadKey]);

  const shouldAnimate = mode !== "preview";

  const seqRef = useRef(0);
  const topRef = useRef<Layer>({ seq: 0, output });
  const lastEpochRef = useRef(output.transition.epoch);
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
  }, [output, shouldAnimate]);

  function handleLeaveComplete(seq: number) {
    setLayers((prev) => (prev.length > 1 && prev[0]?.seq === seq ? prev.slice(1) : prev));
  }

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
          paused={output.videoUnderlay.paused}
          role={videoRole}
          startAtSeconds={output.videoUnderlay.startAtSeconds}
          transition={transition}
          url={output.videoUnderlay.url}
          videoRef={videoRef}
        />
      ) : null}
    </div>
  );
}
