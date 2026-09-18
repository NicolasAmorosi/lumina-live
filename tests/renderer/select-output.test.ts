/**
 * `selectOutput` — the single source of what the projector shows.
 *
 * Everything the congregation sees is this function's return value, so its
 * invariants are the app's: the overlay wins over the base, a deck that is not
 * ready is black rather than a broken tile, and — the one that cost a
 * hardware-decoder crash to learn — a video keeps its element alive UNDER
 * NEGRO instead of being torn down and rebuilt on every toggle.
 *
 * `selectOutputMemo` gets its own block because its whole reason for existing
 * is a negative: the busiest writer in the store (`setMediaStatus`, ~4 Hz per
 * playing element) must not produce a new output object.
 */
import { beforeEach, describe, expect, test } from "vitest";
import {
  buildCumulativeMs,
  selectOutput,
  selectOutputMemo,
  useProjectionStore,
  type LiveDeck,
} from "@renderer/stores/projection.store";
import { LOGO_URL, assetUrl, slideUrl } from "@shared/urls";
import type { DeckSlide } from "@shared/types/deck";

const initialState = useProjectionStore.getState();

function output() {
  return selectOutput(useProjectionStore.getState());
}

function slide(index: number, advanceAfterMs: number | null = null): DeckSlide {
  return {
    index,
    url: slideUrl(500, index),
    thumbUrl: `${slideUrl(500, index)}/thumb`,
    advanceAfterMs,
  };
}

function deckOf(assetId: number, slideCount: number): LiveDeck {
  const slides = Array.from({ length: slideCount }, (_, i) => slide(i + 1));
  return {
    assetId,
    deckId: 500,
    slides,
    soundtrack: null,
    cumulativeMs: buildCumulativeMs(slides),
    autoAdvance: false,
  };
}

beforeEach(() => {
  useProjectionStore.setState(initialState, true);
});

describe("the overlay wins over the base", () => {
  test("NEGRO is black whatever is selected", () => {
    useProjectionStore.getState().setBase({ kind: "image", assetId: 3 });
    useProjectionStore.getState().setOverlay("black");
    expect(output().kind).toBe("black");
  });

  test("LOGO uses the operator's logo, and falls back to the built-in one", () => {
    useProjectionStore.getState().setOverlay("logo");
    expect(output()).toMatchObject({ kind: "logo", url: LOGO_URL });

    useProjectionStore.getState().setLogoUrl("worship://asset/77");
    expect(output()).toMatchObject({ kind: "logo", url: "worship://asset/77" });
  });

  test("nothing selected at all is the logo, never a black screen", () => {
    // What the projector shows between items of a service: the church's logo
    // is the resting state, and "no signal" is not a thing the congregation
    // should ever see.
    expect(output()).toMatchObject({ kind: "logo", url: LOGO_URL });
  });
});

describe("each kind of base content", () => {
  test("an image", () => {
    useProjectionStore.getState().setBase({ kind: "image", assetId: 12 });
    expect(output()).toMatchObject({ kind: "image", url: assetUrl(12) });
  });

  test("a verse carries its text and reference, not an id", () => {
    useProjectionStore.getState().setBase({ kind: "bible", text: "En el principio…", reference: "Génesis 1:1" });
    expect(output()).toMatchObject({
      kind: "bible",
      text: "En el principio…",
      reference: "Génesis 1:1",
    });
  });

  test("a video, with its epoch", () => {
    useProjectionStore.getState().setBase({ kind: "video", assetId: 5, epoch: 2, startAtSeconds: 0 });
    expect(output()).toMatchObject({ kind: "video", url: assetUrl(5), epoch: 2 });
  });

  test("a deck slide carries its position and warms its neighbours", () => {
    const store = useProjectionStore.getState();
    store.setLiveDeck(deckOf(9, 5));
    store.setBase({ kind: "deck", assetId: 9, slideIndex: 3 });

    expect(output()).toMatchObject({
      kind: "slide",
      deckAssetId: 9,
      url: slideUrl(500, 3),
      index: 3,
      total: 5,
      // The next slide first: a slide change must never wait on a decode.
      preload: [slideUrl(500, 4), slideUrl(500, 2)],
    });
  });

  test("the slide index is clamped to the deck", () => {
    const store = useProjectionStore.getState();
    store.setLiveDeck(deckOf(9, 3));
    store.setBase({ kind: "deck", assetId: 9, slideIndex: 99 });
    expect(output()).toMatchObject({ index: 3, total: 3 });
  });
});

describe("a deck that is not ready is black, never a broken tile", () => {
  test("no deck loaded yet", () => {
    useProjectionStore.getState().setBase({ kind: "deck", assetId: 9, slideIndex: 1 });
    expect(output().kind).toBe("black");
  });

  test("the loaded deck belongs to another asset", () => {
    const store = useProjectionStore.getState();
    store.setLiveDeck(deckOf(4, 2));
    store.setBase({ kind: "deck", assetId: 9, slideIndex: 1 });
    expect(output().kind).toBe("black");
  });

  test("a deck with no slides", () => {
    const store = useProjectionStore.getState();
    store.setLiveDeck(deckOf(9, 0));
    store.setBase({ kind: "deck", assetId: 9, slideIndex: 1 });
    expect(output().kind).toBe("black");
  });
});

describe("the video underlay survives the overlay", () => {
  // The element is kept mounted under NEGRO/LOGO instead of being destroyed
  // and recreated: repeatedly tearing down a `<video>` is what produced
  // `PIPELINE_ERROR_DECODE` in Chromium's hardware decoder after a few cycles.
  test("a video under NEGRO is still described, so its element stays alive", () => {
    const store = useProjectionStore.getState();
    store.setBase({ kind: "video", assetId: 5, epoch: 2, startAtSeconds: 12 });
    store.setOverlay("black");

    const out = output();
    expect(out.kind).toBe("black");
    expect(out.videoUnderlay).toMatchObject({ url: assetUrl(5), epoch: 2, startAtSeconds: 12 });
  });

  test("pause and volume travel as state, not as a command", () => {
    const store = useProjectionStore.getState();
    store.setBase({ kind: "video", assetId: 5, epoch: 1, startAtSeconds: 0 });
    useProjectionStore.getState().setVideoPaused(true);
    useProjectionStore.getState().setVideoVolume(0.4);

    expect(output().videoUnderlay).toMatchObject({ paused: true, volume: 0.4 });
  });

  test("the volume is clamped in the store, never at the call site", () => {
    const store = useProjectionStore.getState();
    store.setBase({ kind: "video", assetId: 5, epoch: 1, startAtSeconds: 0 });
    useProjectionStore.getState().setVideoVolume(1.4);
    expect(output().videoUnderlay).toMatchObject({ volume: 1 });
    useProjectionStore.getState().setVideoVolume(-0.2);
    expect(output().videoUnderlay).toMatchObject({ volume: 0 });
  });

  test("anything that is not a video has no underlay", () => {
    useProjectionStore.getState().setBase({ kind: "image", assetId: 3 });
    expect(output().videoUnderlay).toBeNull();
  });

  test("sending something new live resets an operator's pause", () => {
    const store = useProjectionStore.getState();
    store.setBase({ kind: "video", assetId: 5, epoch: 1, startAtSeconds: 0 });
    useProjectionStore.getState().setVideoPaused(true);
    useProjectionStore.getState().setBase({ kind: "video", assetId: 6, epoch: 2, startAtSeconds: 0 });
    expect(output().videoUnderlay).toMatchObject({ paused: false });
  });

  test("moving the resume point does not remount the element", () => {
    // `setVideoResumeAt` patches `base` in place: a new epoch is what remounts
    // the `<video>`, and nothing about what the projector shows changed here.
    const store = useProjectionStore.getState();
    store.setBase({ kind: "video", assetId: 5, epoch: 3, startAtSeconds: 0 });
    useProjectionStore.getState().setVideoResumeAt(42);

    expect(output().videoUnderlay).toMatchObject({ epoch: 3, startAtSeconds: 42 });
  });

  test("the resume point is ignored when the base is not a video", () => {
    useProjectionStore.getState().setBase({ kind: "image", assetId: 3 });
    useProjectionStore.getState().setVideoResumeAt(42);
    expect(useProjectionStore.getState().base).toMatchObject({ kind: "image", assetId: 3 });
  });
});

describe("the scene transition", () => {
  test("navigating within what is live is an instant cut", () => {
    const store = useProjectionStore.getState();
    store.setLiveDeck(deckOf(9, 5));
    store.setBase({ kind: "deck", assetId: 9, slideIndex: 1 });
    const before = output().transition.epoch;

    useProjectionStore.getState().setSlideIndex(2);
    expect(output().transition.epoch).toBe(before);
  });

  test("beginning a scene is what makes the projector fade", () => {
    const before = output().transition.epoch;
    useProjectionStore.getState().beginScene();
    expect(output().transition.epoch).toBe(before + 1);
  });

  test("a new scene retires the scene and video error notices, but not audio's", () => {
    // Re-sending the very same file has to be a real retry; an audio track's
    // notice belongs to the track list's lifecycle instead.
    const store = useProjectionStore.getState();
    store.setMediaError({ target: { kind: "scene" }, url: "worship://asset/1", code: null });
    store.setMediaError({ target: { kind: "video" }, url: "worship://asset/2", code: 4 });
    store.setMediaError({ target: { kind: "audio", trackId: "asset:3:1" }, url: "worship://asset/3", code: 4 });

    useProjectionStore.getState().beginScene();
    expect(Object.keys(useProjectionStore.getState().mediaErrors)).toEqual(["audio:asset:3:1"]);
  });
});

describe("selectOutputMemo", () => {
  test("a media status report does not produce a new output", () => {
    // The whole point: the store's busiest writer touches no field the output
    // reads, and every subscriber uses the default comparator.
    const store = useProjectionStore.getState();
    store.setBase({ kind: "image", assetId: 3 });
    const first = selectOutputMemo(useProjectionStore.getState());

    useProjectionStore.getState().setMediaStatus({
      target: { kind: "video" },
      epoch: 1,
      currentTimeSeconds: 12.5,
      durationSeconds: 300,
      paused: false,
      ended: false,
    });

    expect(selectOutputMemo(useProjectionStore.getState())).toBe(first);
  });

  test("a real change produces a new one", () => {
    const store = useProjectionStore.getState();
    store.setBase({ kind: "image", assetId: 3 });
    const first = selectOutputMemo(useProjectionStore.getState());

    useProjectionStore.getState().setOverlay("black");
    const second = selectOutputMemo(useProjectionStore.getState());

    expect(second).not.toBe(first);
    expect(second.kind).toBe("black");
  });
});

describe("buildCumulativeMs", () => {
  test("slide n hands over at the sum of every advance before it", () => {
    const slides = [slide(1, 1000), slide(2, 2000), slide(3, 500)];
    // Index 0 is unused; `cumulative[1]` is 0, i.e. slide 1 appears at t=0.
    expect(buildCumulativeMs(slides)).toEqual([0, 0, 1000, 3000, 3500]);
  });

  test("a slide with no timing contributes nothing", () => {
    expect(buildCumulativeMs([slide(1, null), slide(2, 1000)])).toEqual([0, 0, 0, 1000]);
  });

  test("an empty deck still yields the two leading zeroes", () => {
    expect(buildCumulativeMs([])).toEqual([0, 0]);
  });
});
