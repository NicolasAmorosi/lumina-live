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
 *  decoder on macOS after a few NEGRO/EN VIVO cycles. */
export type VideoUnderlay = { url: string; epoch: number } | null;

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

export type MediaTarget = "video" | "audio";

export type MediaCommand =
  | { target: MediaTarget; action: "play" }
  | { target: MediaTarget; action: "pause" }
  | { target: MediaTarget; action: "seek"; timeSeconds: number }
  | { target: MediaTarget; action: "restart" }
  | { target: MediaTarget; action: "setVolume"; volume: number };

/** Reported by whichever media element is playing in the projection window.
 *  Generalizes the never-implemented `video-status`: it now drives both the
 *  deck autoplay scheduler and the preview progress bar. */
export type MediaStatus = {
  target: MediaTarget;
  epoch: number;
  currentTimeSeconds: number;
  durationSeconds: number;
  paused: boolean;
  ended: boolean;
};

/**
 * Which audio element should exist in the projection window. Deliberately NOT
 * part of `ProjectionOutput`: a deck's soundtrack has to survive NEGRO/LOGO and
 * every slide change, so it cannot be keyed off `output`.
 */
export type DeckSoundtrackPush = { url: string; epoch: number } | null;

/** What the control window has selected as "base" content (before black/logo overlay). */
export type BaseContent =
  | { kind: "deck"; assetId: number; slideIndex: number }
  | { kind: "video"; assetId: number; epoch: number }
  | { kind: "image"; assetId: number }
  | { kind: "bible"; text: string; reference: string }
  | { kind: "text"; body: string };

export type OverlayState = "none" | "black" | "logo";
