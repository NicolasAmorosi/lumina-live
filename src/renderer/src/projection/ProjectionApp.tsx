import { useEffect, useRef, useState } from "react";
import { api } from "@renderer/lib/api";
import { onIpc } from "@renderer/lib/ipc";
import { OutputView } from "@renderer/components/shared/output-view";
import { useMediaStatusReporter } from "./use-media-status-reporter";
import type { AudioTrackPush, MediaCommand, ProjectionOutput } from "@shared/types/projection";

type AudioTrackElementProps = {
  onRef: (element: HTMLAudioElement | null) => void;
  track: AudioTrackPush;
};

/**
 * One live audio track. Any number of these can be mounted at once — a deck's
 * soundtrack plus every standalone audio asset sent live — each independent
 * of `OutputView` because none of them are keyed off what's on screen: they
 * have to keep playing through NEGRO/LOGO and every slide change.
 *
 * `paused` is declarative (set from the control window's media panel), so an
 * operator's explicit pause survives an overlay round-trip and a projection
 * window reload the same way `LiveVideo`'s does.
 */
function AudioTrackElement({ onRef, track }: AudioTrackElementProps) {
  const elementRef = useRef<HTMLAudioElement | null>(null);
  useMediaStatusReporter(elementRef, track.trackId, track.epoch);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    if (track.paused) element.pause();
    else element.play().catch(() => undefined);
  }, [track.paused]);

  // Applied once, the moment metadata is available — after that the operator
  // scrubs through the panel's own `seek` command, not this.
  useEffect(() => {
    const element = elementRef.current;
    if (!element || track.startAtSeconds <= 0) return;
    const apply = () => {
      element.currentTime = track.startAtSeconds;
    };
    if (element.readyState >= 1) apply();
    else element.addEventListener("loadedmetadata", apply, { once: true });
    return () => element.removeEventListener("loadedmetadata", apply);
    // Intentionally only on mount/epoch change: startAtSeconds is a one-shot
    // starting point, not something to re-apply on every re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track.epoch]);

  function attach(element: HTMLAudioElement | null) {
    elementRef.current = element;
    onRef(element);
  }

  return <audio autoPlay={!track.paused} ref={attach} src={track.url} />;
}

/**
 * The projection window is a pure function of its declarative inputs — it owns
 * no domain logic (no schedule, no Bible, no deck timings) and no state of its
 * own to lose: reopening it and replaying main's snapshot (projection-state.ts)
 * is what makes that safe.
 *
 * There are two inputs, not one. `display-content` says what pixels to show;
 * `audio-tracks` says which audio elements should exist — a deck's soundtrack
 * and any number of standalone audio assets sent live, none of them keyed off
 * the current output because they have to outlive every slide change and keep
 * playing through NEGRO/LOGO.
 *
 * The pixels themselves are `OutputView`, the very component the control
 * window's monitors use, so a confidence monitor can never disagree with the
 * projector.
 */
export function ProjectionApp() {
  const [output, setOutput] = useState<ProjectionOutput>({
    kind: "black",
    videoUnderlay: null,
  });
  const [tracks, setTracks] = useState<AudioTrackPush[]>([]);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRefs = useRef<Map<string, HTMLAudioElement>>(new Map());

  // A fresh `projection:open` shows this window before its page has loaded,
  // so goLive() (which runs right after opening it, with no wait for
  // readiness) can push `display-content`/`audio-tracks` before these
  // listeners exist — a silent drop, not a queued delivery. Pulling main's
  // last known state once mounted closes that race without depending on any
  // load-event timing. `sawPush` stops a late-arriving snapshot from
  // clobbering a push that has since arrived.
  useEffect(() => {
    let sawPush = false;
    const offOutput = onIpc("display-content", (next) => {
      sawPush = true;
      setOutput(next);
    });
    const offTracks = onIpc("audio-tracks", (next) => {
      sawPush = true;
      setTracks(next);
    });
    void api.projection.getSnapshot().then(({ output: snapshot, audioTracks }) => {
      if (sawPush) return;
      if (snapshot) setOutput(snapshot);
      setTracks(audioTracks);
    });
    return () => {
      offOutput();
      offTracks();
    };
  }, []);

  useEffect(
    () =>
      onIpc("media-command", (command: MediaCommand) => {
        const el =
          command.target.kind === "video"
            ? videoRef.current
            : (audioRefs.current.get(command.target.trackId) ?? null);
        if (!el) return;
        switch (command.action) {
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

  useMediaStatusReporter(videoRef, null, output.videoUnderlay?.epoch ?? 0);

  return (
    <div className="h-screen w-screen bg-black">
      <OutputView mode="live" output={output} videoRef={videoRef} />

      {/* Outside the output view on purpose: keyed by trackId+epoch so a track
          restarts from the beginning only when it is truly a new play (a
          fresh EN VIVO on the same asset bumps the epoch), never merely
          because NEGRO/LOGO or a pause toggled. */}
      {tracks.map((track) => (
        <AudioTrackElement
          key={`${track.trackId}:${track.epoch}`}
          onRef={(element) => {
            if (element) audioRefs.current.set(track.trackId, element);
            else audioRefs.current.delete(track.trackId);
          }}
          track={track}
        />
      ))}
    </div>
  );
}
