import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import { mediaTargetKey } from "@shared/types/projection";
import type {
  BaseContent,
  MediaStatus,
  OverlayState,
  ProjectionOutput,
  ProjectionOutputKind,
  SceneTransition,
  TransitionStyle,
  VideoUnderlay,
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

export type ProjectionStoreState = {
  base: BaseContent | null;
  overlay: OverlayState;
  logoUrl: string | null;
  presentationOpen: boolean;
  /** Declarative, operator-set pause for the live video — see `VideoUnderlay`.
   *  Reset to `false` whenever `base` changes, so a fresh EN VIVO always
   *  starts playing. */
  videoPaused: boolean;

  liveDeck: LiveDeck | null;
  autoplay: AutoplayState;
  autoplayMode: AutoplayMode;
  soundtrackEpoch: number;
  /** Keyed by `mediaTargetKey` — one slot per media element (the video, each
   *  live audio track) so two elements reporting at once can never overwrite
   *  each other's clock. */
  mediaStatus: Record<string, MediaStatus>;

  /** Bumped exactly once per "send something new live" action — `goLive()`,
   *  `clearLive()`, `clearBaseContent()`, `setOverlayDirect()` — never by
   *  `setBase`/`setSlideIndex`/`projectVerse` themselves. That asymmetry is
   *  what makes advancing a slide or a verse an instant cut while sending a
   *  new scene live fades: the projection window fades only when this
   *  changes, not merely because the pixels changed. See `beginScene()`. */
  sceneEpoch: number;
  transitionStyle: TransitionStyle;
  transitionDurationMs: number;

  setBase: (base: BaseContent | null) => void;
  setOverlay: (overlay: OverlayState) => void;
  setLogoUrl: (url: string | null) => void;
  setPresentationOpen: (open: boolean) => void;
  setVideoPaused: (paused: boolean) => void;

  setLiveDeck: (deck: LiveDeck | null) => void;
  setSlideIndex: (index: number) => void;
  setAutoplay: (state: AutoplayState) => void;
  setAutoplayMode: (mode: AutoplayMode) => void;
  setMediaStatus: (status: MediaStatus) => void;

  /** Marks "this is a new scene" — see `sceneEpoch`. Called once by every
   *  action that sends something new live, before it touches `base`/`overlay`,
   *  so the very first output already carries the new epoch. */
  beginScene: () => void;
  setTransitionSettings: (style: TransitionStyle, durationMs: number) => void;
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
    videoPaused: false,

    liveDeck: null,
    autoplay: "off",
    autoplayMode: "synced",
    soundtrackEpoch: 0,
    mediaStatus: {},

    sceneEpoch: 0,
    transitionStyle: "crossfade",
    transitionDurationMs: 300,

    setBase: (base) => set({ base, videoPaused: false }),
    setOverlay: (overlay) => set({ overlay }),
    setLogoUrl: (logoUrl) => set({ logoUrl }),
    setPresentationOpen: (presentationOpen) => set({ presentationOpen }),
    setVideoPaused: (videoPaused) => set({ videoPaused }),

    setLiveDeck: (liveDeck) =>
      set((state) => ({
        liveDeck,
        autoplay: "off",
        autoplayMode: "synced",
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
    setMediaStatus: (status) =>
      set((state) => ({
        mediaStatus: { ...state.mediaStatus, [mediaTargetKey(status.target)]: status },
      })),

    beginScene: () => set((state) => ({ sceneEpoch: state.sceneEpoch + 1 })),
    setTransitionSettings: (transitionStyle, transitionDurationMs) =>
      set({ transitionStyle, transitionDurationMs }),
  })),
);

/**
 * The single function that replaces the legacy `restorePrevious()`
 * (app.js:408-418). There is no "restore" step anymore: `base` already IS the
 * last thing chosen, so leaving black/logo is just `overlay = 'none'` and this
 * selector recomputes. The switch below is exhaustive — TypeScript refuses to
 * compile if a new BaseContent variant is added and not handled here.
 */
/** `base`'s own video identity, regardless of NEGRO/LOGO — see `VideoUnderlay`. */
function selectVideoUnderlay(state: ProjectionStoreState): VideoUnderlay {
  if (state.base?.kind !== "video") return null;
  return {
    url: assetUrl(state.base.assetId),
    epoch: state.base.epoch,
    paused: state.videoPaused,
    startAtSeconds: state.base.startAtSeconds,
  };
}

function selectOutputWithoutUnderlay(state: ProjectionStoreState): ProjectionOutputKind {
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

function selectTransition(state: ProjectionStoreState): SceneTransition {
  return {
    epoch: state.sceneEpoch,
    style: state.transitionStyle,
    durationMs: state.transitionDurationMs,
  };
}

export function selectOutput(state: ProjectionStoreState): ProjectionOutput {
  return {
    ...selectOutputWithoutUnderlay(state),
    videoUnderlay: selectVideoUnderlay(state),
    transition: selectTransition(state),
  };
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
