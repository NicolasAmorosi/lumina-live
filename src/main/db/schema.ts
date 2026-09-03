import { integer, sqliteTable, text, uniqueIndex, index } from "drizzle-orm/sqlite-core";

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
    inLibrary: integer("in_library").notNull().default(1),
    lastSeenAt: integer("last_seen_at"),
    missingSince: integer("missing_since"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("ux_media_path").on(t.pathKey),
    index("ix_media_kind").on(t.kind, t.inLibrary, t.name),
  ],
);

export const services = sqliteTable(
  "services",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    notes: text("notes"),
    serviceDate: integer("service_date"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    lastOpenedAt: integer("last_opened_at"),
  },
  (t) => [index("ix_services_recent").on(t.lastOpenedAt)],
);

/**
 * Polymorphic playlist items. A single table + CHECK constraint (kept in the SQL
 * migration, Drizzle's schema builder can't express table-level CHECK) beats a
 * table-per-kind here: one JOIN-free query renders the whole playlist.
 */
export const serviceItems = sqliteTable(
  "service_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    serviceId: integer("service_id")
      .notNull()
      .references(() => services.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    kind: text("kind", { enum: ["media", "ppt", "bible", "text"] }).notNull(),

    mediaAssetId: integer("media_asset_id").references(() => mediaAssets.id, {
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

    textBody: text("text_body"),
    title: text("title"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("ix_items_service").on(t.serviceId, t.position)],
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
    serviceId: integer("service_id").references(() => services.id, { onDelete: "set null" }),
    reference: text("reference"),
    snapshotJson: text("snapshot_json").notNull(),
  },
  (t) => [index("ix_history_time").on(t.projectedAt)],
);

export const pptSlideCache = sqliteTable("ppt_slide_cache", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sourcePath: text("source_path").notNull(),
  mtimeMs: integer("mtime_ms").notNull(),
  slideIndex: integer("slide_index").notNull(),
  imagePath: text("image_path").notNull(),
});

// bible_verses_fts (FTS5 virtual table + sync triggers) is NOT declared here — drizzle-kit's
// schema builder has no FTS5 primitive. It is added by hand in drizzle/0000_init.sql, right
// after this schema's generated CREATE TABLE statements. See db/migrate.ts for the seed step
// that follows migrations.
