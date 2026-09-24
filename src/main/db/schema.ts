import { integer, real, sqliteTable, text, uniqueIndex, index } from "drizzle-orm/sqlite-core";

/** Key/value settings. Replaces the legacy settings.json. */
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

/**
 * Every external file the app references — video/image/audio AND PowerPoint files
 * share this table because they share the exact same problem: absolute paths the
 * user can move or delete. `pathKey` is the normalized (NFC + lowercased on
 * Windows) path used for the uniqueness check; `path` keeps the original casing.
 */
export const mediaAssets = sqliteTable(
  "media_assets",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    kind: text("kind", { enum: ["video", "image", "audio", "ppt"] }).notNull(),
    path: text("path").notNull(),
    pathKey: text("path_key").notNull(),
    name: text("name").notNull(),
    ext: text("ext").notNull(),
    sizeBytes: integer("size_bytes"),
    mtimeMs: integer("mtime_ms"),
    durationMs: integer("duration_ms"),
    linkedAudioPath: text("linked_audio_path"),
    /** Set once the operator explicitly assigns or removes a linked audio
     *  (`library:setLinkedAudio`) — freezes `ensureLinkedAudio`'s automatic
     *  re-resolution for this asset, so "remove" actually means "no audio"
     *  instead of "guess again on the next refresh". */
    linkedAudioManual: integer("linked_audio_manual").notNull().default(0),
    /** Which `LINKED_AUDIO_RESOLVER_VERSION` produced the current
     *  `linkedAudioPath` for a non-manual row. Lets `ensureLinkedAudio` trust
     *  a cached result (including a cached "no match") instead of re-reading
     *  the folder/file on every deck open, while still forcing one re-check
     *  per asset when the matching rules change. */
    linkedAudioResolvedVersion: integer("linked_audio_resolved_version").notNull().default(0),
    /** SHA-256 of the file's bytes — the same identity `slide_decks` is keyed
     *  by. It lives here so a question about an asset ("is this converted?",
     *  "which deck is its first slide in?") can be answered by CONTENT rather
     *  than by which asset happens to own the deck row: `slide_decks`
     *  .`media_asset_id` is exclusive and `relinkDeck` moves it, so with the
     *  same file present twice only the last one opened looked converted.
     *  See `N3` in `auditorias/reports/2026-09-11-cadena-de-media.md` §5.2. */
    contentHash: text("content_hash"),
    /** The `(size, mtime)` the hash was computed over. `contentHash` is only
     *  trustworthy while these still match `sizeBytes`/`mtimeMs` — the same
     *  invalidation rule `tryCacheHit` already applies to a deck row, and the
     *  reason the hash never has to be recomputed just to be used. */
    contentHashSize: integer("content_hash_size"),
    contentHashMtimeMs: integer("content_hash_mtime_ms"),
    inLibrary: integer("in_library").notNull().default(1),
    lastSeenAt: integer("last_seen_at"),
    missingSince: integer("missing_since"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("ux_media_path").on(t.pathKey),
    index("ix_media_kind").on(t.kind, t.inLibrary, t.name),
    /** Both directions of the content join: `statusesByAsset` looks decks up
     *  by an asset's hash, and the backfill scans for assets that still have
     *  none. */
    index("ix_media_content_hash").on(t.contentHash),
  ],
);

export const programs = sqliteTable(
  "programs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    notes: text("notes"),
    favorite: integer("favorite", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    lastOpenedAt: integer("last_opened_at"),
    /** Manual list order, set by dragging rows in the programs modal — the
     *  list is deliberately NOT sorted by `lastOpenedAt`, so opening a
     *  program never shuffles the shelf the operator arranged. Lower comes
     *  first; a brand new program takes `MIN(sort_order) - 1` (negatives are
     *  fine) so it lands on top, and `reorder()` renormalizes to `0..n-1`. */
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("ix_programs_recent").on(t.lastOpenedAt), index("ix_programs_order").on(t.sortOrder)],
);

/**
 * Polymorphic playlist items. A single table + CHECK constraint (kept in the SQL
 * migration, Drizzle's schema builder can't express table-level CHECK) beats a
 * table-per-kind here: one JOIN-free query renders the whole playlist.
 */
export const programItems = sqliteTable(
  "program_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    programId: integer("program_id")
      .notNull()
      .references(() => programs.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    kind: text("kind", { enum: ["media", "ppt", "bible", "utility"] }).notNull(),

    mediaAssetId: integer("media_asset_id").references(() => mediaAssets.id, {
      onDelete: "restrict",
    }),

    /** The saved time scene a `utility` row projects. `restrict` for the same
     *  reason `media_asset_id` has it: a program that silently loses a row
     *  when a list is tidied is worse than a delete the operator has to
     *  confirm. Declared AFTER `utilityScenes` exists at module scope, which
     *  is why the reference is a thunk. */
    utilitySceneId: integer("utility_scene_id").references(() => utilityScenes.id, {
      onDelete: "restrict",
    }),

    bibleVersionId: integer("bible_version_id").references(() => bibleVersions.id, {
      onDelete: "set null",
    }),
    bibleBookId: integer("bible_book_id").references(() => bibleBooks.id, {
      onDelete: "set null",
    }),
    bibleChapter: integer("bible_chapter"),
    bibleVerseFrom: integer("bible_verse_from"),
    bibleVerseTo: integer("bible_verse_to"),
    bibleReference: text("bible_reference"),
    bibleText: text("bible_text"),

    title: text("title"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("ix_items_program").on(t.programId, t.position)],
);

export const bibleVersions = sqliteTable("bible_versions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  language: text("language").notNull().default("es"),
  isBuiltin: integer("is_builtin").notNull().default(0),
  verseCount: integer("verse_count").notNull().default(0),
  sourceHash: text("source_hash"),
  installedAt: integer("installed_at").notNull(),
});

export const bibleBooks = sqliteTable(
  "bible_books",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    versionId: integer("version_id")
      .notNull()
      .references(() => bibleVersions.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    abbrev: text("abbrev").notNull(),
    name: text("name").notNull(),
    testament: text("testament", { enum: ["OT", "NT"] }).notNull(),
    chapterCount: integer("chapter_count").notNull(),
  },
  (t) => [uniqueIndex("ux_book_version_position").on(t.versionId, t.position)],
);

export const bibleVerses = sqliteTable(
  "bible_verses",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    versionId: integer("version_id")
      .notNull()
      .references(() => bibleVersions.id, { onDelete: "cascade" }),
    bookId: integer("book_id")
      .notNull()
      .references(() => bibleBooks.id, { onDelete: "cascade" }),
    chapter: integer("chapter").notNull(),
    verse: integer("verse").notNull(),
    text: text("text").notNull(),
  },
  (t) => [
    uniqueIndex("ux_verse").on(t.versionId, t.bookId, t.chapter, t.verse),
    index("ix_verse_chapter").on(t.bookId, t.chapter, t.verse),
  ],
);

/** Keyed by (version code, abbrev, chapter, verse) so re-seeding a Bible never orphans favorites. */
export const bibleFavorites = sqliteTable("bible_favorites", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  versionCode: text("version_code").notNull(),
  bookAbbrev: text("book_abbrev").notNull(),
  chapter: integer("chapter").notNull(),
  verseFrom: integer("verse_from").notNull(),
  verseTo: integer("verse_to").notNull(),
  reference: text("reference").notNull(),
  label: text("label"),
  createdAt: integer("created_at").notNull(),
});

export const projectionHistory = sqliteTable(
  "projection_history",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    projectedAt: integer("projected_at").notNull(),
    kind: text("kind").notNull(),
    mediaAssetId: integer("media_asset_id").references(() => mediaAssets.id, {
      onDelete: "set null",
    }),
    programId: integer("program_id").references(() => programs.id, { onDelete: "set null" }),
    reference: text("reference"),
    snapshotJson: text("snapshot_json").notNull(),
  },
  (t) => [index("ix_history_time").on(t.projectedAt)],
);

/**
 * A converted PowerPoint/Impress deck, cached on disk. Identity is the SOURCE
 * FILE'S CONTENT HASH, not the media_assets row — two library entries pointing
 * at copies of the same file share one conversion, and a mtime-only touch
 * (a cloud-sync re-write) is a hash hit instead of a multi-minute reconvert.
 * `mediaAssetId` is a SET NULL fast-path FK (deliberately not RESTRICT like
 * `program_items` — a cache row must never block deleting a library asset).
 */
export const slideDecks = sqliteTable(
  "slide_decks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    contentHash: text("content_hash").notNull(),
    renderWidth: integer("render_width").notNull(),
    imageFormat: text("image_format", { enum: ["webp", "png"] }).notNull(),
    converterVersion: integer("converter_version").notNull(),
    mediaAssetId: integer("media_asset_id").references(() => mediaAssets.id, {
      onDelete: "set null",
    }),
    sourcePath: text("source_path").notNull(),
    sourceSizeBytes: integer("source_size_bytes").notNull(),
    sourceMtimeMs: integer("source_mtime_ms").notNull(),
    cacheDir: text("cache_dir").notNull(),
    slideCount: integer("slide_count").notNull().default(0),
    aspectRatio: text("aspect_ratio"),
    status: text("status", { enum: ["pending", "converting", "ready", "error"] }).notNull(),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    timingsSource: text("timings_source", { enum: ["ooxml", "ooxml-converted", "none"] })
      .notNull()
      .default("none"),
    bytesOnDisk: integer("bytes_on_disk").notNull().default(0),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    lastUsedAt: integer("last_used_at").notNull(),
  },
  (t) => [
    uniqueIndex("ux_deck_identity").on(t.contentHash, t.renderWidth, t.imageFormat),
    index("ix_decks_lru").on(t.lastUsedAt),
    index("ix_decks_asset").on(t.mediaAssetId),
  ],
);

/** One rasterized page. `imageFile`/`thumbFile` are basenames only (never an
 *  absolute path) so relocating the whole `userData` directory never
 *  invalidates a row. `slideIndex` is 1-based, in PRESENTATION order
 *  (`p:sldIdLst`), not filename order. */
export const deckSlides = sqliteTable(
  "deck_slides",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    deckId: integer("deck_id")
      .notNull()
      .references(() => slideDecks.id, { onDelete: "cascade" }),
    slideIndex: integer("slide_index").notNull(),
    imageFile: text("image_file").notNull(),
    thumbFile: text("thumb_file").notNull(),
    widthPx: integer("width_px").notNull(),
    heightPx: integer("height_px").notNull(),
    bytes: integer("bytes").notNull(),
    advanceMs: integer("advance_ms"),
    advanceOnClick: integer("advance_on_click").notNull().default(1),
    transitionMs: integer("transition_ms"),
    hidden: integer("hidden").notNull().default(0),
    title: text("title"),
    notes: text("notes"),
  },
  (t) => [uniqueIndex("ux_deck_slide").on(t.deckId, t.slideIndex)],
);

/** Audio extracted from inside the .pptx itself (embedded media, transition
 *  sounds). A *linked* soundtrack — the legacy sibling-`.mp3` convention old
 *  hymnal decks use — is deliberately NOT stored here: it lives on
 *  `media_assets.linked_audio_path` and is served by reference, because it
 *  depends on the source folder, not on the content-addressed deck cache.
 *  See `linked-audio.ts`. */
export const deckAudio = sqliteTable(
  "deck_audio",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    deckId: integer("deck_id")
      .notNull()
      .references(() => slideDecks.id, { onDelete: "cascade" }),
    audioFile: text("audio_file").notNull(),
    ext: text("ext").notNull(),
    bytes: integer("bytes").notNull(),
    origin: text("origin", { enum: ["embedded", "transition"] }).notNull(),
    scope: text("scope", { enum: ["deck", "slide"] }).notNull(),
    startSlideIndex: integer("start_slide_index"),
    stopSlideIndex: integer("stop_slide_index"),
    loop: integer("loop").notNull().default(0),
    volume: integer("volume"),
    playable: integer("playable").notNull().default(1),
  },
  (t) => [index("ix_deck_audio").on(t.deckId, t.startSlideIndex)],
);

/**
 * A video embedded in one slide of a `.pptx`, extracted into the same
 * content-addressed deck cache as `deck_audio`.
 *
 * Its own table rather than a nullable set of columns on `deck_slides`: a
 * video has a geometry, a level and a loop flag that mean nothing for a slide
 * without one, and a slide can carry more than one in the source file even
 * though the projector sustains a single one.
 *
 * `slide_index` is in PAGE order (hidden slides already dropped) — the same
 * index space as `deck_slides.slide_index`, mapped from the OOXML's own
 * numbering in `deck-service.ts`. Storing the OOXML index here would make
 * every reader re-do that mapping, and each one a chance to get it wrong.
 *
 * The rect is four `REAL`s in slide fractions (0..1). Not EMU: the value is
 * meaningless without the slide size it was measured against, and that number
 * does not live on this row.
 */
export const deckVideos = sqliteTable(
  "deck_videos",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    deckId: integer("deck_id")
      .notNull()
      .references(() => slideDecks.id, { onDelete: "cascade" }),
    slideIndex: integer("slide_index").notNull(),
    videoFile: text("video_file").notNull(),
    ext: text("ext").notNull(),
    bytes: integer("bytes").notNull(),
    rectX: real("rect_x").notNull(),
    rectY: real("rect_y").notNull(),
    rectWidth: real("rect_width").notNull(),
    rectHeight: real("rect_height").notNull(),
    loop: integer("loop").notNull().default(0),
    /** 0..100, like `deck_audio.volume` — percent, not a fraction. */
    volume: integer("volume"),
    playable: integer("playable").notNull().default(1),
  },
  (t) => [index("ix_deck_videos").on(t.deckId, t.slideIndex)],
);

// bible_verses_fts (FTS5 virtual table + sync triggers) is NOT declared here — drizzle-kit's
// schema builder has no FTS5 primitive. It is added by hand in drizzle/0000_init.sql, right
// after this schema's generated CREATE TABLE statements. See db/migrate.ts for the seed step
// that follows migrations.

/**
 * The unsaved order of service, mirrored out of the control window.
 *
 * Everything else this app holds reaches SQLite the moment it changes; the
 * schedule being edited lived ONLY in `program.store`, so a reload, a window
 * close, a renderer crash or a power cut threw away what is typically 15-40
 * minutes of work done before the service — the one piece of user data with no
 * backing store at all.
 *
 * A single row (`id = 1`), rewritten wholesale: a draft has no history worth
 * keeping and exactly one reader, the next launch.
 *
 * `items` is a JSON blob rather than rows in `program_items` on purpose. A
 * draft has to be able to hold a row pointing at an asset the operator is
 * about to delete, which is precisely what that table's `onDelete: "restrict"`
 * FK exists to forbid — and a draft must never be the thing that blocks a
 * deletion. `DraftRepo.load()` drops whatever no longer resolves instead.
 */
export const programDraft = sqliteTable("program_draft", {
  id: integer("id").primaryKey(),
  /** The saved program this draft is an edit OF, or null for a brand new one. */
  programId: integer("program_id"),
  name: text("name").notNull(),
  notes: text("notes"),
  /** JSON: `ProgramItemUpsert[]`. */
  items: text("items").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

/**
 * A saved, reusable time scene: a countdown, a clock or a stopwatch with its
 * own background, typography, texts and colour triggers.
 *
 * `tool` is a COLUMN rather than a field of `config_json` because it is the
 * discriminant: the list shows an icon and a label per scene, and it must not
 * have to parse a JSON blob per row to do it. Everything else splits the way
 * `plans/2026-09-17-panel-funciones/utilidades.md` argues it should —
 * `config_json` is what the operator configured (`TimerConfig`) and
 * `style_json` is how it looks (`SceneStyle`, deliberately shaped to be reused
 * by Overlays and by the Bible/text projection settings later). Both are JSON
 * and not thirty columns so a change of shape is a branch in
 * `shared/scene-validators.ts`, not a migration.
 *
 * The enum is spelled out rather than imported from `@shared/types/timer`:
 * drizzle-kit reads this file on its own, outside the app's path aliases, the
 * same way `media_assets.kind` inlines `ASSET_KINDS`.
 */
export const utilityScenes = sqliteTable(
  "utility_scenes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    tool: text("tool", { enum: ["countdown", "countdown-to-time", "clock", "stopwatch"] }).notNull(),
    /** JSON: `TimerConfig`. */
    configJson: text("config_json").notNull(),
    /** JSON: `SceneStyle`. */
    styleJson: text("style_json").notNull(),
    /** The line above the number, and the one below it. `null` hides either. */
    title: text("title"),
    message: text("message"),
    /** Manual list order, same scheme as `programs.sort_order`: lower comes
     *  first, a new scene takes `MIN(sort_order) - 1` so it lands on top, and
     *  `reorder()` renormalizes to `0..n-1`. */
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [index("ix_utility_scenes_order").on(t.sortOrder)],
);
