import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";

/** One audio track sonando ahora en la ventana de proyección — either a
 *  standalone asset sent live or a deck's own soundtrack. Kept separate from
 *  `projection.store`'s `base` because, unlike every other kind of content,
 *  audio never replaces what's on screen: any number of these can coexist
 *  with a PPT or a video at the same time. */
export type LiveAudioTrack = {
  trackId: string;
  source: "asset" | "deck";
  /** `null` for the deck's own soundtrack — it isn't a library asset. */
  assetId: number | null;
  /** What the operator reads in the media panel; never sent over IPC. */
  label: string;
  url: string;
  epoch: number;
  paused: boolean;
  startAtSeconds: number;
};

/** Stable id for the one deck-soundtrack slot — at most one at a time,
 *  replaced wholesale by `setDeckTrack` on every `goLiveWithDeck`. */
export const DECK_SOUNDTRACK_TRACK_ID = "deck-soundtrack";

let assetTrackEpoch = 0;

/** Bumps the shared epoch counter — mirrors `videoEpoch` in `playback.ts`.
 *  A track's `epoch` is used as (part of) its React key on the projection
 *  side, so handing out a new one is what makes an `<audio>` element remount
 *  and re-apply `startAtSeconds`, i.e. "restart from the top". */
function nextEpoch(): number {
  assetTrackEpoch += 1;
  return assetTrackEpoch;
}

/** `assetId` is folded into the id so two different assets never collide;
 *  callers are responsible for not calling this for an asset that already
 *  has a live track (see `goLiveWithAudioAsset` in `playback.ts`) — one
 *  asset, one track, always. */
export function nextAssetTrack(assetId: number): { trackId: string; epoch: number } {
  const epoch = nextEpoch();
  return { trackId: `asset:${assetId}:${epoch}`, epoch };
}

type AudioStoreState = {
  tracks: LiveAudioTrack[];

  addTrack: (track: LiveAudioTrack) => void;
  removeTrack: (trackId: string) => void;
  setPaused: (trackId: string, paused: boolean) => void;
  /** Restarts an already-live track in place: bumps its epoch (remounting
   *  the `<audio>` element so `startAtSeconds` re-applies) and unpauses it,
   *  without touching `trackId` — used when EN VIVO targets an asset that is
   *  already in the list but paused, so it plays again instead of stacking a
   *  second instance of the same audio. */
  restartTrack: (trackId: string, startAtSeconds: number) => void;
  /** Replaces the single deck-soundtrack slot; `null` clears it. Every other
   *  track (standalone audio assets) is untouched — a deck change never cuts
   *  audio the operator sent live independently. */
  setDeckTrack: (track: Omit<LiveAudioTrack, "trackId" | "source" | "assetId"> | null) => void;
  clear: () => void;
};

export const useAudioStore = create<AudioStoreState>()(
  subscribeWithSelector((set) => ({
    tracks: [],

    addTrack: (track) => set((state) => ({ tracks: [...state.tracks, track] })),

    removeTrack: (trackId) =>
      set((state) => ({ tracks: state.tracks.filter((t) => t.trackId !== trackId) })),

    setPaused: (trackId, paused) =>
      set((state) => ({
        tracks: state.tracks.map((t) => (t.trackId === trackId ? { ...t, paused } : t)),
      })),

    restartTrack: (trackId, startAtSeconds) =>
      set((state) => ({
        tracks: state.tracks.map((t) =>
          t.trackId === trackId ? { ...t, epoch: nextEpoch(), paused: false, startAtSeconds } : t,
        ),
      })),

    setDeckTrack: (track) =>
      set((state) => {
        const rest = state.tracks.filter((t) => t.trackId !== DECK_SOUNDTRACK_TRACK_ID);
        if (!track) return { tracks: rest };
        const deckTrack: LiveAudioTrack = {
          ...track,
          trackId: DECK_SOUNDTRACK_TRACK_ID,
          source: "deck",
          assetId: null,
        };
        return { tracks: [...rest, deckTrack] };
      }),

    clear: () => set({ tracks: [] }),
  })),
);
