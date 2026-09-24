/**
 * The single value the control window computes and the projection window renders.
 * A pure discriminated union — adding a new variant that isn't handled in the
 * `selectOutput` switch (renderer/stores/projection.store.ts) is a compile error,
 * not a runtime "stuck on logo" bug like the old `restorePrevious()`.
 */
import type { SlideRect } from "./deck";
import type { SceneStyle } from "./scene-style";
import type { TimerClock, TimerFormat } from "./timer";
import type { TransitionSpec } from "./transition";
import type { UtilityScene } from "./utility";

/** Which video (if any) is the current *base* content, independent of NEGRO/
 *  LOGO. Present on every `ProjectionOutput` variant (including "black" and
 *  "logo" themselves) so the projection window can keep a video's element —
 *  and therefore its OS-level hardware decoder session — alive and playing
 *  underneath an overlay instead of tearing it down and recreating it on every
 *  toggle. Repeatedly destroying/recreating a `<video>` element is what
 *  produces `PIPELINE_ERROR_DECODE` crashes in Chromium's hardware video
 *  decoder on macOS after a few NEGRO/EN VIVO cycles.
 *
 *  `paused` is declarative state, not a command: an explicit pause from the
 *  operator's media panel must survive an overlay round-trip (NEGRO no longer
 *  force-resumes a video the operator paused on purpose), so "should this be
 *  playing" travels in the same push as "what should this be showing".
 *
 *  `startAtSeconds` is the point the operator chose on the preview scrubber
 *  before pressing EN VIVO. Applied once, right when the element mounts for
 *  this `epoch` — never re-applied on a later re-render or overlay toggle. */
export type VideoUnderlay = {
  url: string;
  epoch: number;
  paused: boolean;
  startAtSeconds: number;
  /** 0..1, straight onto `HTMLMediaElement.volume`. Declarative, like
   *  `paused` and for the same reason: a one-shot command would be lost by
   *  every remount — a new epoch, or the projection window being rebuilt onto
   *  another screen — and the operator would be left with a level the app
   *  believes it is at and the room cannot hear. */
  volume: number;
} | null;

/**
 * A video embedded in the slide that is currently live, positioned inside it.
 *
 * Top-level on `ProjectionOutput` and NOT a field of the `slide` variant, for
 * exactly the reason `videoUnderlay` is: NEGRO/LOGO replaces the output kind
 * with `black`/`logo`, so a video that lived inside the `slide` variant would
 * vanish from the push the instant the operator covered the stage — unmounting
 * the element, losing its position, and recreating the hardware decoder on
 * every toggle, which is the documented road to `PIPELINE_ERROR_DECODE`. The
 * projector covers it (opacity 0) and pauses it instead, and uncovering
 * resumes where it was. Same treatment as a full-screen video, deliberately:
 * the video stops, a deck's soundtrack does not.
 *
 * `rect` is where it goes INSIDE the slide (fractions, 0..1) — so the
 * projector has to lay it over the letterboxed image box, never over the whole
 * stage. `paused`, `volume` and `startAtSeconds` are the same declarative
 * fields, with the same meanings, that `VideoUnderlay` documents.
 */
export type SlideVideo = {
  url: string;
  /** Identity of THIS element for its whole mount. Advances when the live
   *  slide changes, never when an overlay goes up — a slide video that keeps
   *  its epoch is the same element, still holding its position. */
  epoch: number;
  rect: SlideRect;
  /** The slide's own width/height ratio. The projector needs it to reproduce
   *  the box `object-contain` gave the slide image, which is what `rect` is
   *  relative to — the stage's own ratio is not it whenever the two differ. */
  aspectRatio: number;
  loop: boolean;
  paused: boolean;
  startAtSeconds: number;
  /** 0..1 */
  volume: number;
} | null;

export type ProjectionOutputKind =
  | { kind: "black" }
  | { kind: "logo"; url: string | null }
  | { kind: "image"; url: string }
  | { kind: "video"; url: string; epoch: number }
  | { kind: "bible"; text: string; reference: string }
  | {
      kind: "slide";
      /** media_assets.id of the source deck — lets HistoryRepo coalesce a whole
       *  deck into one row instead of one per slide change. */
      deckAssetId: number;
      url: string;
      /** 1-based. */
      index: number;
      total: number;
      /** Neighbour full-res urls the projection window should warm up so a
       *  slide change never waits on a decode. Computed here (domain logic
       *  belongs in the control window), materialized there. */
      preload: string[];
    }
  /**
   * A generated time scene: a countdown, the wall clock or a stopwatch.
   *
   * Everything here is either a MARK the projection window subtracts against
   * its own clock, or FORMATTING it applies to the result — see `TimerClock`
   * and `TimerFormat`. Nothing in it is a decision, and nothing in it changes
   * while the count runs, which is what keeps `sceneContentKey` stable and
   * the scene from re-animating once per second.
   */
  | {
      kind: "timer";
      clock: TimerClock;
      format: TimerFormat;
      style: SceneStyle;
      /** Resolved from `style.background` when it is an image — the same
       *  reason `VideoUnderlay` carries a url and not an `assetId`: the
       *  projection window resolves nothing. `null` for every other kind of
       *  background. */
      backgroundUrl: string | null;
      title: string | null;
      /** Swapped for `endMessage` by the projector itself once the countdown
       *  passes zero: a pure function of the mark it is already rendering, so
       *  making the control window push it would mean a clock and a push per
       *  second — and a full scene transition at exactly the wrong moment. */
      message: string | null;
      endMessage: string | null;
    };

/** Carried on every `ProjectionOutput` so the projection window (and the
 *  LIVE monitor) can tell "the same scene, re-sent" from "a genuinely new
 *  scene" without any side channel. `epoch` only advances when the control
 *  window deliberately begins a new scene (`beginScene()` in
 *  `projection.store.ts`) — navigating within what's already live (a slide,
 *  a verse) never bumps it, which is what keeps that navigation an instant
 *  cut instead of a fade. `style`/`durationMs` are a mirror of the
 *  `projection.transition.*` settings, folded in here (not sent over a
 *  separate channel) for the same reason `videoUnderlay` lives here: the
 *  projection window stays a pure function of one input, and the value
 *  survives the snapshot replay in `main/services/projection-state.ts`. The
 *  fade itself is the shared `TransitionSpec` (`./transition`), the same one a
 *  time scene's end state carries — "none" here is always what a confidence
 *  monitor other than LIVE gets. */
export type SceneTransition = TransitionSpec & { epoch: number };

/** Used by every preview output (`use-preview.ts`) — stage one of the
 *  two-stage flow never fades, no matter what the projector is configured
 *  to do. */
export const INSTANT_TRANSITION: SceneTransition = { epoch: 0, style: "none", durationMs: 0 };

export type ProjectionOutput = ProjectionOutputKind & {
  videoUnderlay: VideoUnderlay;
  slideVideo: SlideVideo;
  transition: SceneTransition;
};

/** Identifies one media element in the projection window: the full-screen
 *  video, the video embedded in the live slide, or one of N simultaneous audio
 *  tracks by its `trackId`. The first two are single slots because the
 *  projector only ever sustains one of each. */
export type MediaTarget =
  | { kind: "video" }
  | { kind: "slideVideo" }
  | { kind: "audio"; trackId: string };

/** The string key `mediaStatus` and command routing are indexed by — collapses
 *  `MediaTarget` to a value usable as an object/Map key. A `switch` rather
 *  than a ternary so a fourth target cannot be added without landing here. */
export function mediaTargetKey(target: MediaTarget): string {
  switch (target.kind) {
    case "video":
      return "video";
    case "slideVideo":
      return "slideVideo";
    case "audio":
      return `audio:${target.trackId}`;
  }
}

/** Which element of the projection window failed. "scene" is the still image
 *  of an image/slide/logo output — the only one without a `MediaTarget`,
 *  because nothing ever commands it. */
export type MediaErrorTarget = MediaTarget | { kind: "scene" };

/** The key `mediaErrors` is indexed by. Deliberately shares the namespace of
 *  `mediaTargetKey` — "video"/"audio:<id>" mean the same element in both
 *  records, so one prune pass can keep status and error in step. */
export function mediaErrorKey(target: MediaErrorTarget): string {
  return target.kind === "scene" ? "scene" : mediaTargetKey(target);
}

/**
 * Something the projector was told to show could not be loaded or decoded —
 * a file deleted or a drive unplugged mid-service, a codec Chromium refuses.
 * Reported by the failing element itself, exactly like `MediaStatus`: the
 * element is describing itself, nothing is inferred.
 *
 * Without this the projection just goes black and, because the confidence
 * monitors render the very same `ProjectionOutput` through the very same
 * component, they repeat the lie — the one thing the monitors are not allowed
 * to do.
 *
 * `url` is what makes the notice self-expiring: the control window only
 * paints it while what is live still IS that url, so moving to the next slide
 * or sending anything else live drops it with no explicit clearing and no
 * chance of a stale warning outliving the content it describes.
 */
export type ProjectionMediaError = {
  target: MediaErrorTarget;
  url: string;
  /** `HTMLMediaElement.error.code` when there is one; `null` for an `<img>`,
   *  which reports no reason at all. Diagnostic only — nothing branches on it. */
  code: number | null;
};

/** Play/pause and volume are declarative (`VideoUnderlay`, `AudioTrackPush`)
 *  so they survive a projection-window reload the same way "what's on screen"
 *  does. Only actions that are genuinely one-shot commands remain here — a
 *  seek and a restart say "move now", they do not describe a state to hold. */
export type MediaCommand =
  | { target: MediaTarget; action: "seek"; timeSeconds: number }
  | { target: MediaTarget; action: "restart" };

/** Reported by whichever media element is playing in the projection window.
 *  Generalizes the never-implemented `video-status`: it now drives both the
 *  deck autoplay scheduler and every media transport bar. */
export type MediaStatus = {
  target: MediaTarget;
  epoch: number;
  currentTimeSeconds: number;
  durationSeconds: number;
  paused: boolean;
  ended: boolean;
};

/**
 * One audio element the projection window should keep mounted, independent of
 * `ProjectionOutput` — a deck's soundtrack and any number of standalone audio
 * assets sent live all have to survive every slide change, so none of them
 * can be keyed off `output`. `paused` is declarative for the same reason as
 * `VideoUnderlay.paused` — with one difference: for the deck's own soundtrack,
 * the control window folds NEGRO/LOGO into this `paused` before sending it
 * (see `projection-sync.ts`), so it pauses/resumes through an overlay exactly
 * like a video; a standalone asset track is untouched by the overlay.
 *
 * `startAtSeconds` is applied once, right after the element mounts (the
 * operator's chosen start point from the preview scrubber) — folding it into
 * this push instead of a follow-up `seek` command avoids a race between two
 * separate IPC sends and "has the element mounted yet".
 */
export type AudioTrackPush = {
  trackId: string;
  url: string;
  epoch: number;
  paused: boolean;
  startAtSeconds: number;
  /** 0..1 — see `VideoUnderlay.volume`. */
  volume: number;
};

/** What the control window has selected as "base" content (before black/logo overlay). */
export type BaseContent =
  | { kind: "deck"; assetId: number; slideIndex: number }
  | { kind: "video"; assetId: number; epoch: number; startAtSeconds: number }
  | { kind: "image"; assetId: number }
  | { kind: "bible"; text: string; reference: string }
  /**
   * A utility scene on the projector.
   *
   * The scene travels RESOLVED, not as an id: `selectOutput` is a pure
   * function of `ProjectionStoreState` and its memo compares that tuple by
   * reference (`outputInputs`), so reaching into `utility.store` from inside
   * it would break both. It is the same rule `videoUnderlay` follows.
   *
   * `clock` is separate from `scene.config` because it is the only part that
   * moves: pause, resume and reset rewrite it in place (`setTimerClock`)
   * without beginning a new scene, and editing the scene while it is live
   * rewrites `scene` the same way.
   */
  | { kind: "utility"; sceneId: number; scene: UtilityScene; clock: TimerClock };

export type OverlayState = "none" | "black" | "logo";
