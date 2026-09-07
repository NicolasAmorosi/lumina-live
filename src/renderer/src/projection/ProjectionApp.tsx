import { useEffect, useRef, useState } from "react";
import { onIpc } from "@renderer/lib/ipc";
import { useMediaStatusReporter } from "./use-media-status-reporter";
import type {
  DeckSoundtrackPush,
  MediaCommand,
  ProjectionOutput,
} from "@shared/types/projection";

/**
 * The projection window is a pure function of its declarative inputs — it owns
 * no domain logic (no playlist, no Bible, no deck schedule) and no state of its
 * own to lose: reopening it and replaying main's snapshot (projection-state.ts)
 * is what makes that safe.
 *
 * There are two inputs, not one. `display-content` says what pixels to show;
 * `deck-soundtrack` says which audio element should exist. They are separate
 * precisely because a deck's music has to outlive every slide change and keep
 * playing through NEGRO/LOGO — it cannot be keyed off the current output.
 */
export function ProjectionApp() {
  const [output, setOutput] = useState<ProjectionOutput>({ kind: "black" });
  const [soundtrack, setSoundtrack] = useState<DeckSoundtrackPush>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => onIpc("display-content", setOutput), []);
  useEffect(() => onIpc("deck-soundtrack", setSoundtrack), []);

  useEffect(
    () =>
      onIpc("media-command", (command: MediaCommand) => {
        const el = command.target === "audio" ? audioRef.current : videoRef.current;
        if (!el) return;
        switch (command.action) {
          case "play":
            void el.play();
            break;
          case "pause":
            el.pause();
            break;
          case "seek":
            el.currentTime = command.timeSeconds;
            break;
          case "restart":
            el.currentTime = 0;
            void el.play();
            break;
          case "setVolume":
            el.volume = command.volume;
            break;
        }
      }),
    [],
  );

  // Warm the neighbouring slides so a change never waits on a decode. Plain
  // Image objects rather than hidden DOM nodes: no layout, no paint, and
  // nothing stray in the render tree.
  const preloadKey = output.kind === "slide" ? output.preload.join("|") : "";
  useEffect(() => {
    if (!preloadKey) return;
    for (const url of preloadKey.split("|")) {
      const img = new Image();
      img.decoding = "async";
      img.src = url;
    }
  }, [preloadKey]);

  useMediaStatusReporter(videoRef, "video", output.kind === "video" ? output.epoch : 0);
  useMediaStatusReporter(audioRef, "audio", soundtrack?.epoch ?? 0);

  return (
    <div className="relative flex h-screen w-screen items-center justify-center bg-black text-white">
      {output.kind === "logo" && output.url ? (
        <img alt="" className="max-h-full max-w-full object-contain" src={output.url} />
      ) : null}
      {output.kind === "image" ? (
        <img alt="" className="max-h-full max-w-full object-contain" src={output.url} />
      ) : null}
      {/* No `key` on the slide image: swapping the src attribute lets React
          reuse the element, which avoids a white flash between slides. */}
      {output.kind === "slide" ? (
        <img
          alt=""
          className="max-h-full max-w-full object-contain"
          decoding="sync"
          src={output.url}
        />
      ) : null}
      {output.kind === "video" ? (
        <video
          autoPlay
          className="max-h-full max-w-full"
          key={output.epoch}
          ref={videoRef}
          src={output.url}
        />
      ) : null}
      {output.kind === "bible" ? (
        <div
          className="flex flex-col items-center gap-6 px-16 text-center"
          style={{ textShadow: "0 2px 8px rgba(0,0,0,0.8)" }}
        >
          <p style={{ fontSize: "3.5vw", fontWeight: 300 }}>{output.text}</p>
          <p style={{ fontSize: "2vw", fontWeight: 600 }}>{output.reference}</p>
        </div>
      ) : null}
      {output.kind === "text" ? (
        <p
          className="px-16 text-center"
          style={{ fontSize: "4vw", textShadow: "0 2px 8px rgba(0,0,0,0.8)" }}
        >
          {output.body}
        </p>
      ) : null}
      {/* black renders nothing — it IS the bg-black. */}

      {/* Outside the output list on purpose: keyed by epoch, never by url or
          output, so it survives slide changes and NEGRO/LOGO. */}
      {soundtrack ? (
        <audio autoPlay key={soundtrack.epoch} ref={audioRef} src={soundtrack.url} />
      ) : null}
    </div>
  );
}
