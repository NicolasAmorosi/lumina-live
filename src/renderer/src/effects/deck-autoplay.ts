import { api } from "@renderer/lib/api";
import { useProjectionStore, type LiveDeck } from "@renderer/stores/projection.store";
import { SLIDES_MIN_ADVANCE_MS } from "@shared/constants";

/**
 * Deck auto-advance lives in the CONTROL window, never in the projection
 * window — the projection window stays a pure function of its declarative
 * inputs (`display-content` + `deck-soundtrack`).
 *
 * Two modes:
 *
 * - **synced** (a deck with a soundtrack, before any manual navigation): the
 *   slide index is derived from the audio element's own clock. Every
 *   `media-status` re-derives which slide should be up and re-arms a single
 *   timeout, so a ten-minute soundtrack cannot accumulate drift — the timer is
 *   a latency optimization, not the clock.
 * - **detached** (after the operator navigates by hand, or when there is no
 *   soundtrack): a monotonic deadline chain. The music keeps playing exactly
 *   where it was — the operator moved the slide, not the song — and advancing
 *   resumes relative to the slide they picked.
 */

let timer: ReturnType<typeof setTimeout> | null = null;
/** Bumped on every manual navigation so a `media-status` already in flight
 *  can't yank the slide back a beat later. */
let navEpoch = 0;
let deadline = 0;
let seededEpoch = -1;

function clearTimer(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
}

function advanceMsFor(deck: LiveDeck, slideIndex: number): number | null {
  const advance = deck.slides[slideIndex - 1]?.advanceAfterMs;
  return advance === null || advance === undefined
    ? null
    : Math.max(SLIDES_MIN_ADVANCE_MS, advance);
}

/** Last slide whose boundary is at or before `timeMs`. */
function slideAtAudioTime(deck: LiveDeck, timeMs: number): number {
  let index = 1;
  for (let n = 1; n <= deck.slides.length; n += 1) {
    const boundary = deck.cumulativeMs[n];
    if (boundary === undefined || boundary > timeMs) break;
    index = n;
  }
  return index;
}

function scheduleDetached(): void {
  clearTimer();
  const state = useProjectionStore.getState();
  const { liveDeck, base, autoplay } = state;
  if (autoplay !== "playing" || !liveDeck || base?.kind !== "deck") return;

  const advance = advanceMsFor(liveDeck, base.slideIndex);
  if (advance === null) return;

  const epochAtSchedule = navEpoch;
  // Monotonic chain: a late timeout must not push every later boundary out.
  deadline = Math.max(deadline, performance.now()) + advance;
  const delay = Math.max(0, deadline - performance.now());

  timer = setTimeout(() => {
    if (epochAtSchedule !== navEpoch) return;
    const current = useProjectionStore.getState();
    if (current.autoplay !== "playing" || current.base?.kind !== "deck") return;

    const next = current.base.slideIndex + 1;
    if (next > (current.liveDeck?.slides.length ?? 0)) {
      current.setAutoplay("finished");
      return;
    }
    current.setSlideIndex(next);
    scheduleDetached();
  }, delay);
}

function scheduleSynced(audioTimeMs: number): void {
  clearTimer();
  const state = useProjectionStore.getState();
  const { liveDeck, base, autoplay } = state;
  if (autoplay !== "playing" || !liveDeck || base?.kind !== "deck") return;

  const nextBoundary = liveDeck.cumulativeMs[base.slideIndex + 1];
  if (nextBoundary === undefined) return;

  const epochAtSchedule = navEpoch;
  // Land slightly early so the image swap happens ON the boundary, not after.
  const delay = Math.max(0, nextBoundary - audioTimeMs - 40);

  timer = setTimeout(() => {
    if (epochAtSchedule !== navEpoch) return;
    const current = useProjectionStore.getState();
    if (current.autoplay !== "playing" || current.base?.kind !== "deck") return;
    const next = current.base.slideIndex + 1;
    if (next > (current.liveDeck?.slides.length ?? 0)) {
      current.setAutoplay("finished");
      return;
    }
    current.setSlideIndex(next);
  }, delay);
}

/** Called by playback actions when the operator drives the deck by hand. */
export function notifyManualNavigation(): void {
  navEpoch += 1;
  const state = useProjectionStore.getState();
  // Manual navigation detaches the slide cursor from the audio clock: the
  // soundtrack keeps playing where it is (the chosen behaviour), and
  // auto-advance re-arms relative to the slide the operator picked.
  if (state.autoplayMode !== "detached") state.setAutoplayMode("detached");
  deadline = performance.now();
  if (state.autoplay === "playing") scheduleDetached();
  else clearTimer();
}

export function pauseAutoplay(): void {
  const state = useProjectionStore.getState();
  if (state.autoplay !== "playing") return;
  clearTimer();
  state.setAutoplay("paused");
  if (state.liveDeck?.soundtrack) {
    void api.projection.mediaCommand({ target: "audio", action: "pause" });
  }
}

export function resumeAutoplay(): void {
  const state = useProjectionStore.getState();
  if (state.autoplay !== "paused" && state.autoplay !== "finished") return;
  state.setAutoplay("playing");
  deadline = performance.now();
  if (state.liveDeck?.soundtrack) {
    void api.projection.mediaCommand({ target: "audio", action: "play" });
  }
  if (state.autoplayMode === "detached" || !state.liveDeck?.soundtrack) scheduleDetached();
}

export function toggleAutoplay(): void {
  const { autoplay } = useProjectionStore.getState();
  if (autoplay === "playing") pauseAutoplay();
  else if (autoplay === "paused" || autoplay === "finished") resumeAutoplay();
}

export function restartDeck(): void {
  const state = useProjectionStore.getState();
  if (state.base?.kind !== "deck") return;
  navEpoch += 1;
  deadline = performance.now();
  state.setSlideIndex(1);
  state.setAutoplayMode("synced");
  if (state.liveDeck?.soundtrack) {
    void api.projection.mediaCommand({ target: "audio", action: "restart" });
  }
  if (state.liveDeck?.autoAdvance) {
    state.setAutoplay("playing");
    if (!state.liveDeck.soundtrack) scheduleDetached();
  }
}

export function startDeckAutoplay(): () => void {
  // Re-arm whenever a deck is loaded or autoplay is toggled from elsewhere.
  const unsubscribeDeck = useProjectionStore.subscribe(
    (state) => `${state.liveDeck?.assetId ?? "none"}:${state.autoplay}:${state.autoplayMode}`,
    () => {
      const state = useProjectionStore.getState();
      if (state.autoplay !== "playing") {
        clearTimer();
        return;
      }
      // Without a soundtrack there's no audio clock to sync to.
      if (!state.liveDeck?.soundtrack || state.autoplayMode === "detached") {
        scheduleDetached();
      }
    },
  );

  const unsubscribeStatus = useProjectionStore.subscribe(
    (state) => state.mediaStatus,
    (status) => {
      if (!status || status.target !== "audio") return;
      const state = useProjectionStore.getState();
      const deck = state.liveDeck;
      if (!deck?.soundtrack || state.base?.kind !== "deck") return;

      // Reopening the projection window mid-deck gives us a fresh <audio> that
      // starts at 0. Seek it back to where the current slide belongs — but only
      // while still synced; a detached deck's music is intentionally elsewhere.
      if (seededEpoch !== state.soundtrackEpoch) {
        seededEpoch = state.soundtrackEpoch;
        const expected = deck.cumulativeMs[state.base.slideIndex] ?? 0;
        if (state.autoplayMode === "synced" && expected > 0 && status.currentTimeSeconds < 0.5) {
          void api.projection.mediaCommand({
            target: "audio",
            action: "seek",
            timeSeconds: expected / 1000,
          });
          return;
        }
      }

      if (status.ended) {
        clearTimer();
        if (state.autoplay === "playing") state.setAutoplay("finished");
        return;
      }
      if (state.autoplay !== "playing" || state.autoplayMode !== "synced") return;

      const audioTimeMs = status.currentTimeSeconds * 1000;
      const expected = slideAtAudioTime(deck, audioTimeMs);
      if (expected !== state.base.slideIndex) state.setSlideIndex(expected);
      scheduleSynced(audioTimeMs);
    },
  );

  return () => {
    clearTimer();
    unsubscribeDeck();
    unsubscribeStatus();
  };
}
