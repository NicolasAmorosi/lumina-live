/**
 * The single value the control window computes and the projection window renders.
 * A pure discriminated union — adding a new variant that isn't handled in the
 * `selectOutput` switch (renderer/stores/projection.store.ts) is a compile error,
 * not a runtime "stuck on logo" bug like the old `restorePrevious()`.
 */
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
} | null;

export type ProjectionOutputKind =
  | { kind: "black" }
  | { kind: "logo"; url: string | null }
  | { kind: "image"; url: string }
  | { kind: "video"; url: string; epoch: number }
  | { kind: "bible"; text: string; reference: string }
  | { kind: "text"; body: string }
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
    };

export type ProjectionOutput = ProjectionOutputKind & { videoUnderlay: VideoUnderlay };

/** Identifies one media element in the projection window: the single video,
 *  or one of N simultaneous audio tracks by its `trackId`. */
export type MediaTarget = { kind: "video" } | { kind: "audio"; trackId: string };

/** The string key `mediaStatus` and command routing are indexed by — collapses
 *  `MediaTarget` to a value usable as an object/Map key. */
export function mediaTargetKey(target: MediaTarget): string {
  return target.kind === "video" ? "video" : `audio:${target.trackId}`;
}

/** Play/pause are declarative now (`VideoUnderlay.paused`, `AudioTrackPush.paused`)
 *  so they survive a projection-window reload the same way "what's on screen"
 *  does. Only actions that are genuinely one-shot commands remain here. */
export type MediaCommand =
  | { target: MediaTarget; action: "seek"; timeSeconds: number }
  | { target: MediaTarget; action: "restart" }
  | { target: MediaTarget; action: "setVolume"; volume: number };

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
 * assets sent live all have to survive NEGRO/LOGO and every slide change, so
 * none of them can be keyed off `output`. `paused` is declarative for the same
 * reason as `VideoUnderlay.paused`.
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
};

/** What the control window has selected as "base" content (before black/logo overlay). */
export type BaseContent =
  | { kind: "deck"; assetId: number; slideIndex: number }
  | { kind: "video"; assetId: number; epoch: number; startAtSeconds: number }
  | { kind: "image"; assetId: number }
  | { kind: "bible"; text: string; reference: string }
  | { kind: "text"; body: string };

export type OverlayState = "none" | "black" | "logo";
