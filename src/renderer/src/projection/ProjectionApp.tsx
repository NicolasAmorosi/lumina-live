import { useEffect, useRef, useState } from "react";
import { onIpc } from "@renderer/lib/ipc";
import type { ProjectionOutput, VideoCommand } from "@shared/types/projection";

/**
 * The projection window is a pure function of the last `display-content`
 * message — it owns no domain logic (no playlist, no Bible, no library),
 * exactly like the legacy `presentation.html`. It also has no state of its
 * own to lose: reopening this window and replaying `lastOutput` (main's
 * projection-state.ts) is what makes that safe.
 */
export function ProjectionApp() {
  const [output, setOutput] = useState<ProjectionOutput>({ kind: "black" });
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => onIpc("display-content", setOutput), []);

  useEffect(
    () =>
      onIpc("video-command", (command: VideoCommand) => {
        const video = videoRef.current;
        if (!video) return;
        switch (command.action) {
          case "play":
            void video.play();
            break;
          case "pause":
            video.pause();
            break;
          case "seek":
            video.currentTime = command.timeSeconds;
            break;
          case "restart":
            video.currentTime = 0;
            void video.play();
            break;
        }
      }),
    [],
  );

  return (
    <div className="relative flex h-screen w-screen items-center justify-center bg-black text-white">
      {output.kind === "logo" && output.url ? (
        <img alt="" className="max-h-full max-w-full object-contain" src={output.url} />
      ) : null}
      {output.kind === "image" ? (
        <img alt="" className="max-h-full max-w-full object-contain" src={output.url} />
      ) : null}
      {output.kind === "video" ? (
        <video autoPlay className="max-h-full max-w-full" key={output.epoch} ref={videoRef} src={output.url} />
      ) : null}
      {output.kind === "bible" ? (
        <div className="flex flex-col items-center gap-6 px-16 text-center" style={{ textShadow: "0 2px 8px rgba(0,0,0,0.8)" }}>
          <p style={{ fontSize: "3.5vw", fontWeight: 300 }}>{output.text}</p>
          <p style={{ fontSize: "2vw", fontWeight: 600 }}>{output.reference}</p>
        </div>
      ) : null}
      {output.kind === "text" ? (
        <p className="px-16 text-center" style={{ fontSize: "4vw", textShadow: "0 2px 8px rgba(0,0,0,0.8)" }}>
          {output.body}
        </p>
      ) : null}
      {/* black and ppt render nothing — black is the bg-black itself, ppt hands the
          screen to PowerPoint (the window is hidden while a slideshow is active). */}
    </div>
  );
}
