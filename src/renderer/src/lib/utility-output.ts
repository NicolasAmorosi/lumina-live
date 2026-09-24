import { assetUrl } from "@shared/urls";
import type { ProjectionOutputKind } from "@shared/types/projection";
import type { TimerClock } from "@shared/types/timer";
import type { UtilityScene } from "@shared/types/utility";

/**
 * A utility scene as the projection window wants it.
 *
 * Shared by `selectOutput` (what actually goes on the projector) and
 * `usePreviewOutput` (the PREVIEW monitor), which is the point: two
 * independent translations of the same scene would be two chances for the
 * monitor to show something the projector does not — the one thing the
 * confidence monitors may never do.
 *
 * Resolving the background's `assetId` into a url is this layer's job, exactly
 * like a video's or an image's: the projection window turns no id into
 * anything.
 */
export function timerOutputFor(
  scene: UtilityScene,
  clock: TimerClock,
): Extract<ProjectionOutputKind, { kind: "timer" }> {
  const { background } = scene.style;
  return {
    kind: "timer",
    clock,
    format: scene.config.format,
    style: scene.style,
    // `assetId === 0` is the image background that has not been given a file
    // yet (see `backgroundOfKind`): a url for it would 404, and the projector —
    // and the editor's preview with it — would paint the browser's broken-image
    // glyph over the scene. No url is what "nothing" looks like.
    backgroundUrl: background.kind === "image" && background.assetId > 0 ? assetUrl(background.assetId) : null,
    title: scene.title,
    message: scene.message,
    endMessage: scene.config.endMessage,
  };
}
