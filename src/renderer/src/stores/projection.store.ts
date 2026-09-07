import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import type {
  BaseContent,
  MediaStatus,
  OverlayState,
  ProjectionOutput,
} from "@shared/types/projection";
import type { DeckSlide, DeckSoundtrack } from "@shared/types/deck";
import { assetUrl, LOGO_URL } from "@shared/urls";

/** The deck currently loaded for projection — slide urls are durable, DB-backed
 *  and stable across restarts, so this is plain data with no session lifecycle. */
export type LiveDeck = {
  assetId: number;
  deckId: number;
  slides: DeckSlide[];
  soundtrack: DeckSoundtrack | null;
  /** Audio timestamp at which slide i should appear; index 0 unused, so
   *  `cumulativeMs[n]` is the boundary for the 1-based slide n. */
  cumulativeMs: number[];
  autoAdvance: boolean;
};

export type AutoplayState = "off" | "playing" | "paused" | "finished";

/**
 * "synced" = the slide index is a function of audio time, so the schedule can
 * never drift. The first manual navigation switches to "detached": the operator
 * chose a slide, the music keeps playing where it was, and auto-advance
 * continues on a relative timer from that slide instead of snapping back.
 */
export type AutoplayMode = "synced" | "detached";

type ProjectionStoreState = {
  base: BaseContent | null;
  overlay: OverlayState;
  logoUrl: string | null;
  presentationOpen: boolean;

  liveDeck: LiveDeck | null;
  autoplay: AutoplayState;
  autoplayMode: AutoplayMode;
  soundtrackEpoch: number;
  mediaStatus: MediaStatus | null;

  setBase: (base: BaseContent | null) => void;
  setOverlay: (overlay: OverlayState) => void;
  setLogoUrl: (url: string | null) => void;
  setPresentationOpen: (open: boolean) => void;

  setLiveDeck: (deck: LiveDeck | null) => void;
  setSlideIndex: (index: number) => void;
  setAutoplay: (state: AutoplayState) => void;
  setAutoplayMode: (mode: AutoplayMode) => void;
  setMediaStatus: (status: MediaStatus) => void;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export const useProjectionStore = create<ProjectionStoreState>()(
  subscribeWithSelector((set, get) => ({
    base: null,
    overlay: "none",
    logoUrl: null,
    presentationOpen: false,

    liveDeck: null,
    autoplay: "off",
    autoplayMode: "synced",
    soundtrackEpoch: 0,
    mediaStatus: null,

    setBase: (base) => set({ base }),
    setOverlay: (overlay) => set({ overlay }),
    setLogoUrl: (logoUrl) => set({ logoUrl }),
    setPresentationOpen: (presentationOpen) => set({ presentationOpen }),

    setLiveDeck: (liveDeck) =>
      set((state) => ({
        liveDeck,
        autoplay: "off",
        autoplayMode: "synced",
        mediaStatus: null,
        soundtrackEpoch: state.soundtrackEpoch + 1,
      })),

    // Writing the cursor into `base` is what makes a slide change flow through
    // selectOutput -> projection:show like every other content change. The COM
    // version kept it in a side field that the output never read, which is why
    // NEGRO/LOGO over a deck needed the window hide/show dance.
    setSlideIndex: (index) => {
      const { base, liveDeck } = get();
      if (base?.kind !== "deck" || !liveDeck) return;
      const next = clamp(index, 1, Math.max(1, liveDeck.slides.length));
      if (next === base.slideIndex) return;
      set({ base: { ...base, slideIndex: next } });
    },

    setAutoplay: (autoplay) => set({ autoplay }),
    setAutoplayMode: (autoplayMode) => set({ autoplayMode }),
    setMediaStatus: (mediaStatus) => set({ mediaStatus }),
  })),
);

/**
 * The single function that replaces the legacy `restorePrevious()`
 * (app.js:408-418). There is no "restore" step anymore: `base` already IS the
 * last thing chosen, so leaving black/logo is just `overlay = 'none'` and this
 * selector recomputes. The switch below is exhaustive — TypeScript refuses to
 * compile if a new BaseContent variant is added and not handled here.
 */
export function selectOutput(state: ProjectionStoreState): ProjectionOutput {
  if (state.overlay === "black") return { kind: "black" };
  if (state.overlay === "logo") return { kind: "logo", url: state.logoUrl ?? LOGO_URL };
  if (state.base === null) return { kind: "logo", url: state.logoUrl ?? LOGO_URL };

  switch (state.base.kind) {
    case "deck": {
      const deck = state.liveDeck;
      // Defensive: presentSelected() doesn't set `base` until the deck is
      // ready, so this only trips if the window reloads before the store
      // repopulates.
      if (!deck || deck.assetId !== state.base.assetId || deck.slides.length === 0) {
        return { kind: "black" };
      }
      const index = clamp(state.base.slideIndex, 1, deck.slides.length);
      const current = deck.slides[index - 1]!;
      const preload = [deck.slides[index]?.url, deck.slides[index - 2]?.url].filter(
        (url): url is string => url !== undefined,
      );
      return {
        kind: "slide",
        deckAssetId: deck.assetId,
        url: current.url,
        index,
        total: deck.slides.length,
        preload,
      };
    }
    case "video":
      return { kind: "video", url: assetUrl(state.base.assetId), epoch: state.base.epoch };
    case "image":
      return { kind: "image", url: assetUrl(state.base.assetId) };
    case "bible":
      return { kind: "bible", text: state.base.text, reference: state.base.reference };
    case "text":
      return { kind: "text", body: state.base.body };
  }
}

/**
 * `selectOutput` builds a fresh object every call, and `preload` makes it
 * deeply nested — so neither `Object.is` nor `useShallow` can tell "same
 * output" from "new object". Memoizing identity in ONE place lets both the
 * effect subscription and the live monitor use the default comparator, instead
 * of each carrying its own workaround (a JSON equalityFn here, a useShallow
 * there) for the same problem.
 */
let lastOutput: ProjectionOutput | null = null;
let lastKey = "";

export function selectOutputMemo(state: ProjectionStoreState): ProjectionOutput {
  const next = selectOutput(state);
  const key = JSON.stringify(next);
  if (lastOutput !== null && key === lastKey) return lastOutput;
  lastOutput = next;
  lastKey = key;
  return next;
}

/** Cumulative audio timestamps for a deck's slides, used by the autoplay
 *  scheduler. `cumulativeMs[1] === 0`; `cumulativeMs[n+1]` is when slide n
 *  should hand over. */
export function buildCumulativeMs(slides: DeckSlide[]): number[] {
  const cumulative: number[] = [0, 0];
  for (let i = 0; i < slides.length; i += 1) {
    const advance = slides[i]?.advanceAfterMs ?? 0;
    cumulative[i + 2] = (cumulative[i + 1] ?? 0) + advance;
  }
  return cumulative;
}
