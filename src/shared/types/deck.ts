/**
 * A PowerPoint/Impress deck converted once to a set of rasterized images plus
 * whatever audio/timing metadata could be recovered from the .pptx OOXML.
 * Replaces the COM-driven live slideshow session — a deck is content, not a
 * remote-controlled process, so main owns a cache instead of a slide cursor.
 */
export type DeckStatus = "converting" | "ready" | "failed" | "stale";

export type DeckSlide = {
  /** 1-based, presentation order (`p:sldIdLst`), not filename order. */
  index: number;
  /** worship://deck/<deckId>/<index> — full-resolution image. */
  url: string;
  /** worship://deck/<deckId>/<index>/thumb — small preview. */
  thumbUrl: string;
  /** Auto-advance delay from the .pptx transition timing, in ms. `null` means
   *  this slide only advances manually. */
  advanceAfterMs: number | null;
};

export type DeckSoundtrack = {
  url: string;
  durationMs: number | null;
  /** `embedded`/`transition` come from inside the file and live in the deck
   *  cache; `linked` is an external file resolved per media asset (an old
   *  hymnal's sibling .mp3) and served by reference — see `linked-audio.ts`. */
  origin: "embedded" | "transition" | "linked";
  /** File name, for the "Asignar audio" control to show what's playing. */
  name: string;
};

export type DeckDTO = {
  /** media_assets.id of the .pptx/.ppt — the only handle the renderer needs. */
  assetId: number;
  deckId: number;
  status: DeckStatus;
  slideCount: number;
  /** Empty while converting. */
  slides: DeckSlide[];
  soundtrack: DeckSoundtrack | null;
  /** True iff any slide carries an advanceAfterMs — drives whether autoplay
   *  starts automatically when the deck is presented. */
  autoAdvance: boolean;
  /** "none" means the .pptx/.ppt's own timings couldn't be read or didn't
   *  line up with the rendered pages — auto-advance was disabled on purpose,
   *  not lost by accident. Drives whether the UI shows that as a fact instead
   *  of silence. */
  timingsSource: "ooxml" | "ooxml-converted" | "none";
  sourceMtimeMs: number;
  convertedAt: number;
  error: string | null;
};

export type DeckEnvironment = {
  available: boolean;
  sofficePath: string | null;
  version: string | null;
};

export type DeckProgress = {
  assetId: number;
  status: DeckStatus;
  done: number;
  total: number;
  error: string | null;
};
