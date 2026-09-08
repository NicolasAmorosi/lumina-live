import { useEffect, useRef, useState } from "react";
import { api } from "@renderer/lib/api";
import { onIpc } from "@renderer/lib/ipc";
import { OutputView } from "@renderer/components/shared/output-view";
import { useMediaStatusReporter } from "./use-media-status-reporter";
import type { DeckSoundtrackPush, MediaCommand, ProjectionOutput } from "@shared/types/projection";

/**
 * The projection window is a pure function of its declarative inputs — it owns
 * no domain logic (no schedule, no Bible, no deck timings) and no state of its
 * own to lose: reopening it and replaying main's snapshot (projection-state.ts)
 * is what makes that safe.
 *
 * There are two inputs, not one. `display-content` says what pixels to show;
 * `deck-soundtrack` says which audio element should exist. They are separate
 * precisely because a deck's music has to outlive every slide change and keep
 * playing through NEGRO/LOGO — it cannot be keyed off the current output.
 *
 * The pixels themselves are `OutputView`, the very component the control
 * window's monitors use, so a confidence monitor can never disagree with the
 * projector.
 */
export function ProjectionApp() {
  const [output, setOutput] = useState<ProjectionOutput>({ kind: "black", videoUnderlay: null });
  const [soundtrack, setSoundtrack] = useState<DeckSoundtrackPush>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  // A fresh `projection:open` shows this window before its page has loaded,
  // so goLive() (which runs right after opening it, with no wait for
  // readiness) can push `display-content`/`deck-soundtrack` before these
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
    const offSoundtrack = onIpc("deck-soundtrack", (next) => {
      sawPush = true;
      setSoundtrack(next);
    });
    void api.projection.getSnapshot().then(({ output: snapshot, soundtrack: soundtrackSnapshot }) => {
      if (sawPush) return;
      if (snapshot) setOutput(snapshot);
      if (soundtrackSnapshot) setSoundtrack(soundtrackSnapshot);
    });
    return () => {
      offOutput();
      offSoundtrack();
    };
  }, []);

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

  useMediaStatusReporter(videoRef, "video", output.videoUnderlay?.epoch ?? 0);
  useMediaStatusReporter(audioRef, "audio", soundtrack?.epoch ?? 0);

  return (
    <div className="h-screen w-screen bg-black">
      <OutputView mode="live" output={output} videoRef={videoRef} />

      {/* Outside the output view on purpose: keyed by epoch, never by url or
          output, so it survives slide changes and NEGRO/LOGO. */}
      {soundtrack ? (
        <audio autoPlay key={soundtrack.epoch} ref={audioRef} src={soundtrack.url} />
      ) : null}
    </div>
  );
}
