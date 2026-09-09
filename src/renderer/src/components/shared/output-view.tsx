import { useEffect, useRef, type Ref } from "react";
import { cn } from "@renderer/lib/utils";
import type { ProjectionOutput } from "@shared/types/projection";

export type OutputViewMode = "live" | "preview" | "monitor";

type LiveVideoProps = {
  /** NEGRO/LOGO is over the video right now. */
  covered: boolean;
  mode: OutputViewMode;
  /** Declarative, operator-controlled pause from the media panel — distinct
   *  from `covered`, and deliberately takes priority: an explicit pause must
   *  survive a NEGRO/LOGO round-trip instead of being silently overridden by
   *  it when the overlay comes back off. */
  paused: boolean;
  /** Point the operator chose on the preview scrubber before EN VIVO. Applied
   *  once, right when this element mounts — never re-applied later, so a
   *  scrub from the media panel afterwards isn't fought on the next render. */
  startAtSeconds: number;
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
 */
function LiveVideo({ covered, mode, paused, startAtSeconds, url, videoRef }: LiveVideoProps) {
  const elementRef = useRef<HTMLVideoElement | null>(null);
  // "monitor" (the LIVE confidence monitor) stays frozen on its first frame;
  // "live" and "preview" both drive real playback through this element.
  const canPlay = mode !== "monitor";
  const shouldPlay = canPlay && !covered && !paused;

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
    if (!element || !canPlay) return;
    if (shouldPlay) element.play().catch(() => undefined);
    else element.pause();
  }, [canPlay, shouldPlay]);

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
      className={cn("size-full object-contain", covered && "hidden")}
      // Whitelist, not a check against "monitor": any future mode is muted
      // by default and only the real projector ever gets sound.
      muted={mode !== "live"}
      preload="metadata"
      ref={attach}
      src={url}
    />
  );
}

type OutputViewProps = {
  className?: string;
  /**
   * "live" is the projection window itself: video autoplays and is wired to
   * the media refs, with sound. "preview" is the operator's preview monitor:
   * same pixels, muted, but a video CAN play there under the operator's own
   * play button (see `preview-media-bar.tsx`) — never automatically. "monitor"
   * is the LIVE confidence monitor — same pixels, muted and inert, frozen on
   * the first frame.
   */
  mode: OutputViewMode;
  output: ProjectionOutput;
  videoRef?: Ref<HTMLVideoElement>;
};

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
 */
export function OutputView({ className, mode, output, videoRef }: OutputViewProps) {
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

  return (
    <div
      className={cn(
        "@container relative flex size-full items-center justify-center overflow-hidden bg-black text-white",
        className,
      )}
    >
      {(output.kind === "logo" && output.url) || output.kind === "image" ? (
        <img alt="" className="size-full object-contain" src={output.url ?? undefined} />
      ) : null}

      {/* No `key` on the slide image: swapping the src attribute lets React
          reuse the element, which avoids a white flash between slides. */}
      {output.kind === "slide" ? (
        <img
          alt=""
          className="size-full object-contain"
          decoding={mode === "live" ? "sync" : "async"}
          src={output.url}
        />
      ) : null}

      {/* Keyed by epoch so pressing EN VIVO again on the same video restarts it
          from the beginning, but NOT re-created merely because NEGRO/LOGO
          covers it — see `LiveVideo`. */}
      {output.videoUnderlay ? (
        <LiveVideo
          covered={output.kind !== "video"}
          key={output.videoUnderlay.epoch}
          mode={mode}
          paused={output.videoUnderlay.paused}
          startAtSeconds={output.videoUnderlay.startAtSeconds}
          url={output.videoUnderlay.url}
          videoRef={videoRef}
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

      {/* black renders nothing — it IS the bg-black. */}
    </div>
  );
}
