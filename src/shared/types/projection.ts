/**
 * The single value the control window computes and the projection window renders.
 * A pure discriminated union — adding a new variant that isn't handled in the
 * `selectOutput` switch (renderer/stores/projection.store.ts) is a compile error,
 * not a runtime "stuck on logo" bug like the old `restorePrevious()`.
 */
export type ProjectionOutput =
  | { kind: "black" }
  | { kind: "logo"; url: string | null }
  | { kind: "image"; url: string }
  | { kind: "video"; url: string; epoch: number }
  | { kind: "bible"; text: string; reference: string }
  | { kind: "text"; body: string }
  | { kind: "ppt" };

export type VideoCommand =
  | { action: "play" }
  | { action: "pause" }
  | { action: "seek"; timeSeconds: number }
  | { action: "restart" };

export type VideoStatus = {
  currentTimeSeconds: number;
  durationSeconds: number;
  paused: boolean;
};

/** What the control window has selected as "base" content (before black/logo overlay). */
export type BaseContent =
  | { kind: "ppt"; assetId: number }
  | { kind: "video"; assetId: number; epoch: number }
  | { kind: "image"; assetId: number }
  | { kind: "bible"; text: string; reference: string }
  | { kind: "text"; body: string };

export type OverlayState = "none" | "black" | "logo";
