import { useEffect, useRef, type Ref } from "react";
import { cn } from "@renderer/lib/utils";
import type { ProjectionOutput } from "@shared/types/projection";

export type OutputViewMode = "live" | "monitor";

type LiveVideoProps = {
  /** NEGRO/LOGO is over the video right now. */
  covered: boolean;
  mode: OutputViewMode;
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
 * unseen: the operator expects NEGRO to stop the video. That is deliberately
 * the opposite of a deck's soundtrack (`ProjectionApp`), which is meant to keep
 * playing through an overlay.
 */
function LiveVideo({ covered, mode, url, videoRef }: LiveVideoProps) {
  const elementRef = useRef<HTMLVideoElement | null>(null);

  function attach(element: HTMLVideoElement | null) {
    elementRef.current = element;
    if (typeof videoRef === "function") videoRef(element);
    else if (videoRef) (videoRef as { current: HTMLVideoElement | null }).current = element;
  }

  // `autoPlay` only applies to a freshly loaded element, so transitions in and
  // out of NEGRO/LOGO have to be driven imperatively.
  useEffect(() => {
    const element = elementRef.current;
    if (!element || mode !== "live") return;
    if (covered) element.pause();
    else element.play().catch(() => undefined);
  }, [covered, mode]);

  return (
    <video
      autoPlay={mode === "live" && !covered}
      className={cn("max-h-full max-w-full", covered && "hidden")}
      muted={mode === "monitor"}
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
   * the media refs. "monitor" is a confidence monitor — same pixels, muted and
   * inert.
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
 * variants.
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
        <img alt="" className="max-h-full max-w-full object-contain" src={output.url ?? undefined} />
      ) : null}

      {/* No `key` on the slide image: swapping the src attribute lets React
          reuse the element, which avoids a white flash between slides. */}
      {output.kind === "slide" ? (
        <img
          alt=""
          className="max-h-full max-w-full object-contain"
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
