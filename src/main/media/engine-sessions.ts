import type { WebContents } from "electron";
import { engineAssetIdOfUrl, liveEngineFrameKey, previewEngineFrameKey } from "@shared/urls";
import type { MediaCommand, PreviewEngineVideo } from "@shared/types/projection";
import { getMediaRepo } from "../services/repos";
import { broadcast, controlWindows } from "../services/broadcast";
import { projectionState } from "../services/projection-state";
import { takeEngine, type EngineEvents, type MediaEngine } from "./media-engine";
import { liveEngineState } from "./live-engine-state";

/**
 * The media engine's two sessions: the live video, and the PREVIEW monitor's. Plan
 * `2026-10-25-reproduccion-instantanea`, §6 «Contrato del motor para el paso 1».
 *
 * The live one follows the last `ProjectionOutput`, the very value `projectionState` replays into a
 * rebuilt projector, so main keeps no record of its own of what is live
 * (`.claude/knowledge/main-cannot-know-what-is-live-under-an-overlay.md`). A new epoch is a new file in
 * a new engine; the same one only pauses, resumes or changes its level. The session does not live in
 * the projection window, so rebuilding that window neither restarts the video nor needs its position
 * frozen first.
 *
 * An engine that dies takes only its own session, and stays dead: the operator is told, as with a
 * file the projector cannot open, and decides. GO LIVE again is a new epoch, so a new engine (owner,
 * 2026-10-30).
 */

type Session = { engine: MediaEngine | null; url: string; epoch: number; paused: boolean; volume: number };

const VIDEO = { kind: "video" } as const;

let live: Session | null = null;
let preview: Session | null = null;

/** `session.engine` playing `session.url`, or none when the url names no file — then `events.error`
 *  says so, like the engine itself would. */
function start(
  session: Session,
  opts: { startAtSeconds: number; audio: boolean },
  frameKey: string,
  events: EngineEvents,
): void {
  const assetId = engineAssetIdOfUrl(session.url);
  const file = assetId === null ? null : getMediaRepo().getPathById(assetId);
  if (!file) {
    events.error?.({ code: "engine-open", detail: `no file for ${session.url}` });
    return;
  }
  session.engine = takeEngine();
  session.engine.load(
    { file, startAtSeconds: opts.startAtSeconds, paused: session.paused, volume: session.volume, loop: false, audio: opts.audio },
    frameKey,
    events,
  );
}

/** Called whenever the output or the projector window changes. */
export function syncLiveEngine(): void {
  const projector = projectionState.getWindow();
  const want = liveEngineState(projectionState.getSnapshot().output, projector !== null);
  if (live && (!want || want.epoch !== live.epoch || want.url !== live.url)) {
    live.engine?.quit();
    live = null;
  }
  if (!want) return;

  if (!live) {
    const session: Session = { engine: null, url: want.url, epoch: want.epoch, paused: want.paused, volume: want.volume };
    live = session;
    start(session, { startAtSeconds: want.startAtSeconds, audio: true }, liveEngineFrameKey(want.epoch), {
      status: (status) =>
        broadcast("media-status", {
          target: VIDEO,
          epoch: session.epoch,
          currentTimeSeconds: status.time,
          durationSeconds: status.duration,
          paused: status.paused,
          ended: status.ended,
        }),
      error: (error) => {
        if (live !== session) return;
        console.warn("[engine] live video", error.code, error.detail);
        broadcast("media-error", { target: VIDEO, url: session.url, code: null });
      },
    });
  } else {
    if (want.paused !== live.paused) live.engine?.setPaused(want.paused);
    if (want.volume !== live.volume) live.engine?.setVolume(want.volume);
    live.paused = want.paused;
    live.volume = want.volume;
  }
  // The projector, and the control window's LIVE monitor: one decode, the same frame on both.
  for (const win of [projector, ...controlWindows()]) if (win) live.engine?.show(win.webContents);
}

/** A seek from the media panel, when the live video is the engine's. `restart` is a seek to 0 as
 *  well: whether the video plays is the output's declarative `paused`, never a command's. */
export function commandLiveEngine(command: MediaCommand): boolean {
  if (command.target.kind !== "video" || !live) return false;
  live.engine?.seek(command.action === "seek" ? command.timeSeconds : 0);
  return true;
}

export function setPreviewVideo(video: PreviewEngineVideo | null, contents: WebContents): void {
  if (preview && preview.url !== video?.url) {
    preview.engine?.quit();
    preview = null;
  }
  if (!video) return;
  if (preview) {
    if (video.paused !== preview.paused) preview.engine?.setPaused(video.paused);
    preview.paused = video.paused;
    return;
  }
  // Muted, and with its audio not even decoded: only the projector is ever audible.
  const session: Session = { engine: null, url: video.url, epoch: 0, paused: video.paused, volume: 0 };
  preview = session;
  start(session, { startAtSeconds: video.startAtSeconds, audio: false }, previewEngineFrameKey(video.url), {
    status: (status) =>
      broadcast("preview-video-status", {
        url: session.url,
        currentTimeSeconds: status.time,
        durationSeconds: status.duration,
        paused: status.paused,
        ended: status.ended,
      }),
    error: (error) => {
      if (preview !== session) return;
      console.warn("[engine] preview", error.code, error.detail);
      broadcast("preview-video-error", { url: session.url });
    },
  });
  session.engine?.show(contents);
}

export function seekPreviewVideo(seconds: number): void {
  preview?.engine?.seek(seconds);
}

/** `projection:wantVideoFrame`: a canvas for these frames just mounted. */
export function redrawEngineFrame(key: string): void {
  if (live && key === liveEngineFrameKey(live.epoch)) live.engine?.redraw();
  else if (preview && key === previewEngineFrameKey(preview.url)) preview.engine?.redraw();
}
