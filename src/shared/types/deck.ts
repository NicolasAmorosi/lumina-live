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

/**
 * A rectangle inside the slide, as fractions of the slide's own box (0..1:
 * left, top, width, height).
 *
 * Fractions and not EMU, px or points on purpose: the projector paints the
 * slide with `object-contain`, so the box the video has to land on is whatever
 * the letterboxing left — a number in the source file's own units would have
 * to be converted against that box by every consumer, and every consumer would
 * be a chance to convert it differently.
 */
export type SlideRect = { x: number; y: number; width: number; height: number };

/**
 * A video embedded in one slide of a `.pptx`/`.ppsx`, pulled out of the OOXML
 * into the deck cache and positioned by the rect the file itself declares.
 *
 * Only `.pptx`-family sources produce these: a legacy `.ppt`/`.pps` either
 * never carried the bytes (PowerPoint 97-2003 linked video by absolute path)
 * or loses them through LibreOffice's own exporter — see
 * `.claude/knowledge/an-embedded-deck-video-survives-to-the-pdf-but-never-survives-a-ppt.md`.
 *
 * The rasterized slide underneath is NOT a hole to patch: LibreOffice draws
 * the video's poster frame into exactly this rect, so a deck whose video
 * cannot be extracted or decoded still looks right — it just does not move.
 * That is why an unplayable video is simply absent here rather than reported.
 */
export type DeckSlideVideo = {
  /** 1-based, and the SAME index space as `DeckSlide.index`: page order, with
   *  hidden slides already dropped. The OOXML's own slide numbering counts
   *  hidden slides and is mapped away in `deck-service.ts` before it ever
   *  reaches this type. */
  slideIndex: number;
  /** worship://deck-video/<id> */
  url: string;
  rect: SlideRect;
  /** Width/height of the RASTERIZED slide this rect was measured against.
   *  The projector paints the slide with `object-contain`, so it has to
   *  rebuild that letterboxed box before it can place `rect` inside it — and
   *  taking the ratio from the rendered page rather than from the source's
   *  `p:sldSz` makes it exact by construction: it is literally the image the
   *  `<img>` beside the video is showing. */
  aspectRatio: number;
  /** From the slide's `p:cMediaNode` — PowerPoint's own "repeat until I move
   *  on" flag. */
  loop: boolean;
  /** 0..1, the level the source file declares, or `null` when it declares
   *  none — the app's own default then applies. The operator's level lives in
   *  `projection.store` and overrides both. */
  volume: number | null;
  /** The file name inside the cache, for the media panel's row. */
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
  /** One entry per slide that carries a playable embedded video. Almost always
   *  empty, and never longer than `slides` — a slide with two videos keeps the
   *  first, since `ProjectionOutput` sustains one at a time. */
  videos: DeckSlideVideo[];
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

/** What one library tile needs to know about a deck without asking for the
 *  whole `DeckDTO`: whether it still needs converting, and where its
 *  first-slide thumbnail lives. Answered for a whole grid in one round-trip
 *  (`deck:statuses`) — an asset with no deck row at all simply has no entry.
 *
 *  `thumbUrl` is non-null only for a `ready` deck, and points into the
 *  content-addressed deck cache (`worship://deck/<deckId>/1/thumb`), which is
 *  the authoritative rendering of that slide. A PPT never goes through the
 *  generated media-thumbnail cache. */
export type DeckStatusSummary = {
  status: DeckStatus;
  thumbUrl: string | null;
};

export type DeckEnvironment = {
  available: boolean;
  sofficePath: string | null;
  version: string | null;
  /** Why it is not available, in the operator's language — «not found» is not
   *  the only answer: a sandboxed flatpak, or a path picked by hand that is not
   *  LibreOffice, are installed and still unusable. `null` when available. */
  message: string | null;
};

export type DeckProgress = {
  assetId: number;
  status: DeckStatus;
  done: number;
  total: number;
  error: string | null;
};

/** Aggregate progress of one "Preparar carpeta/vista" batch — a single event
 *  stream so pre-warming hundreds of decks in the background doesn't turn
 *  into hundreds of per-asset store entries and re-renders. Per-tile progress
 *  still comes from `DeckProgress`/`deck-progress` for whichever one is
 *  actually converting right now. */
export type PrewarmProgress = {
  jobId: string;
  /** What to show the operator — e.g. the folder or tab name. */
  label: string;
  total: number;
  done: number;
  /** Already had a ready deck when the batch started. */
  skipped: number;
  failed: number;
  currentAssetId: number | null;
  status: "running" | "done" | "canceled" | "cache-full";
};

/** What the slide cache costs right now, for the one screen that exposes it.
 *  `maxBytes` is `slides.cacheMaxMb` resolved — the budget eviction enforces,
 *  not a hard ceiling: a single deck larger than the budget is still kept. */
export type DeckCacheStats = {
  deckCount: number;
  bytesOnDisk: number;
  maxBytes: number;
};
