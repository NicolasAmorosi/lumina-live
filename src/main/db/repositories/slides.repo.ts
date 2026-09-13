import fs from "node:fs";
import path from "node:path";
import { and, asc, eq, inArray, lt, notInArray, sql } from "drizzle-orm";
import type Database from "better-sqlite3";
import type { Db } from "../client";
import { deckAudio, deckSlides, mediaAssets, slideDecks } from "../schema";
import { slideThumbUrl, slideUrl, deckAudioUrl, linkedAudioUrl } from "@shared/urls";
import type { DeckDTO, DeckSlide, DeckStatus } from "@shared/types/deck";

/** One `IN (...)` binds one parameter per id; SQLite refuses the statement
 *  past `SQLITE_MAX_VARIABLE_NUMBER`. Same partition size `media.repo.ts`
 *  uses. */
const ID_CHUNK = 500;

export type DeckRow = typeof slideDecks.$inferSelect;

/** What `statusesByAsset` knows about an asset's most recent deck row. The
 *  `deckId` rides along because it costs one more column in a query that
 *  already runs, and it is what lets a library tile address the deck's own
 *  first-slide thumbnail (`worship://deck/<deckId>/1/thumb`) without one
 *  `deck:get` per tile. */
export type DeckRowSummary = { deckId: number; status: DeckStatus };
type SlideRow = typeof deckSlides.$inferSelect;
type AudioRow = typeof deckAudio.$inferSelect;

export type NewDeck = {
  contentHash: string;
  renderWidth: number;
  imageFormat: "webp" | "png";
  converterVersion: number;
  mediaAssetId: number | null;
  sourcePath: string;
  sourceSizeBytes: number;
  sourceMtimeMs: number;
  cacheDir: string;
  aspectRatio: string | null;
  timingsSource: "ooxml" | "ooxml-converted" | "none";
  bytesOnDisk: number;
  /** Defaults to the moment of insertion. A background prewarm backdates
   *  this on purpose — see the call site in `deck-service.ts`. */
  lastUsedAt?: number;
};

export type NewSlide = {
  slideIndex: number;
  imageFile: string;
  thumbFile: string;
  widthPx: number;
  heightPx: number;
  bytes: number;
  advanceMs: number | null;
  advanceOnClick: boolean;
  transitionMs: number | null;
  hidden: boolean;
  title: string | null;
  notes: string | null;
};

export type NewAudio = {
  audioFile: string;
  ext: string;
  bytes: number;
  origin: "embedded" | "transition";
  scope: "deck" | "slide";
  startSlideIndex: number | null;
  stopSlideIndex: number | null;
  loop: boolean;
  volume: number | null;
  playable: boolean;
};

export class SlidesRepo {
  constructor(
    private readonly db: Db,
    private readonly sqlite: Database.Database,
  ) {}

  /**
   * Prepared statements for the `worship://` path resolvers.
   *
   * better-sqlite3 caches the compiled plan on the Statement object, so the
   * win is in preparing ONCE — Drizzle builds and compiles a fresh statement
   * per call. Created lazily rather than in the constructor because the repo
   * is constructed before migrations have necessarily created these tables.
   */
  private slideImageStatement: Database.Statement | null = null;
  private audioPathStatement: Database.Statement | null = null;

  private slideImageStmt(): Database.Statement {
    this.slideImageStatement ??= this.sqlite.prepare(
      `SELECT d.cache_dir AS cacheDir, s.image_file AS imageFile, s.thumb_file AS thumbFile
         FROM deck_slides s JOIN slide_decks d ON d.id = s.deck_id
        WHERE s.deck_id = ? AND s.slide_index = ?`,
    );
    return this.slideImageStatement;
  }

  private insertSlideStatement: Database.Statement | null = null;
  private insertAudioStatement: Database.Statement | null = null;

  private insertSlideStmt(): Database.Statement {
    this.insertSlideStatement ??= this.sqlite.prepare(
      `INSERT INTO deck_slides
         (deck_id, slide_index, image_file, thumb_file, width_px, height_px, bytes,
          advance_ms, advance_on_click, transition_ms, hidden, title, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    return this.insertSlideStatement;
  }

  private insertAudioStmt(): Database.Statement {
    this.insertAudioStatement ??= this.sqlite.prepare(
      `INSERT INTO deck_audio
         (deck_id, audio_file, ext, bytes, origin, scope, start_slide_index,
          stop_slide_index, loop, volume, playable)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    return this.insertAudioStatement;
  }

  private audioPathStmt(): Database.Statement {
    this.audioPathStatement ??= this.sqlite.prepare(
      `SELECT d.cache_dir AS cacheDir, a.audio_file AS audioFile
         FROM deck_audio a JOIN slide_decks d ON d.id = a.deck_id
        WHERE a.id = ?`,
    );
    return this.audioPathStatement;
  }

  // -- lookup ---------------------------------------------------------------

  /** Fast path: same file (by size+mtime) already converted for this asset. */
  findDeckByAsset(mediaAssetId: number): DeckRow | null {
    return (
      this.db
        .select()
        .from(slideDecks)
        .where(eq(slideDecks.mediaAssetId, mediaAssetId))
        .orderBy(sql`${slideDecks.lastUsedAt} DESC`)
        .get() ?? null
    );
  }

  /**
   * One query per chunk for a whole grid's worth of assets, instead of
   * `findDeckByAsset` + `fs.existsSync` per asset (what `deckStatuses` used to
   * do). Deliberately skips the filesystem: a cache dir that vanished out from
   * under a `ready` row is caught by the real conversion/cache-hit path
   * (`runConversion`), not by a status badge that exists to answer "does this
   * still need converting?" for hundreds of tiles at once without touching
   * disk hundreds of times.
   *
   * **Asked by CONTENT, then by ownership** — this is the fix for `N3`
   * (media-chain audit §5.2). It used to ask only "which deck row does this
   * asset OWN?", and ownership is exclusive: `relinkDeck` MOVES
   * `mediaAssetId` when another asset resolves to the same bytes, while the
   * cache itself is addressed by `contentHash + renderWidth + imageFormat`.
   * With the same file present twice, one asset held the row and the other
   * reported "pending" forever — measured on the real library, 555 of 1235
   * assets with zero work to do, and a count that oscillated instead of
   * reaching zero because preparing one folder stole the rows back from the
   * other. Every caller inherited it: the "Preparar carpeta" count, the tile
   * thumbnails, and `adoptProgram`'s eviction pins.
   *
   * So the primary lookup joins `media_assets.content_hash` (stamped with the
   * `(size, mtime)` that validates it — see `schema.ts`) to the deck's own
   * `contentHash`. Ownership stays as the fallback for assets whose hash is
   * not stamped yet: the backfill is asynchronous and a grid drawn in the
   * meantime must keep reporting what it reported before, not regress to
   * "nothing is converted".
   *
   * Both passes keep the most recently used row per asset — the same tie-break
   * `findDeckByAsset` uses, and the reason `mediaAssetId` being non-unique
   * here (a re-linked deck leaves old rows around until GC) is harmless.
   */
  statusesByAsset(mediaAssetIds: readonly number[]): Map<number, DeckRowSummary> {
    const result = new Map<number, DeckRowSummary>();
    if (mediaAssetIds.length === 0) return result;

    // Chunked for the same reason `media.repo.ts`'s sweep is: one `IN (...)`
    // binds one parameter per id, and SQLite refuses the statement past
    // SQLITE_MAX_VARIABLE_NUMBER. The caller is a grid handing over every
    // asset it can see, so the day a linked folder holds a few thousand decks
    // this stops being theoretical — and it would fail as a thrown query, not
    // as a slow one.
    //
    // Rows arrive newest-first *within each chunk*, which is all this needs:
    // a given assetId's rows can only ever land in one chunk, since the chunks
    // partition the ids.
    const take = (rows: readonly { id: number; assetId: number | null; status: string }[]) => {
      for (const row of rows) {
        if (row.assetId === null || result.has(row.assetId)) continue;
        // Same DB-status → `DeckStatus` collapse `toDTO` uses ("pending"/
        // "converting" both read as "still converting" to a caller that only
        // wants to know whether it's safe to skip this asset).
        const status: DeckStatus =
          row.status === "ready" ? "ready" : row.status === "error" ? "failed" : "converting";
        result.set(row.assetId, { deckId: row.id, status });
      }
    };

    for (let i = 0; i < mediaAssetIds.length; i += ID_CHUNK) {
      const slice = mediaAssetIds.slice(i, i + ID_CHUNK) as number[];

      // 1. By content. `IS` rather than `=` on purpose: both sides are
      //    nullable, and a row with no size/mtime recorded must not match a
      //    stamp that also has none — but `contentHash IS NOT NULL` already
      //    excludes that, and `IS` keeps the comparison from going NULL (i.e.
      //    silently false-but-not-false) for any other combination.
      take(
        this.db
          .select({ id: slideDecks.id, assetId: mediaAssets.id, status: slideDecks.status })
          .from(mediaAssets)
          .innerJoin(slideDecks, eq(slideDecks.contentHash, mediaAssets.contentHash))
          .where(
            and(
              inArray(mediaAssets.id, slice),
              sql`${mediaAssets.contentHash} IS NOT NULL`,
              sql`${mediaAssets.contentHashSize} IS ${mediaAssets.sizeBytes}`,
              sql`${mediaAssets.contentHashMtimeMs} IS ${mediaAssets.mtimeMs}`,
            ),
          )
          .orderBy(sql`${slideDecks.lastUsedAt} DESC`)
          .all(),
      );

      // 2. By ownership, for whatever the content pass could not answer.
      const unresolved = slice.filter((id) => !result.has(id));
      if (unresolved.length === 0) continue;
      take(
        this.db
          .select({
            id: slideDecks.id,
            assetId: slideDecks.mediaAssetId,
            status: slideDecks.status,
          })
          .from(slideDecks)
          .where(inArray(slideDecks.mediaAssetId, unresolved))
          .orderBy(sql`${slideDecks.lastUsedAt} DESC`)
          .all(),
      );
    }
    return result;
  }

  /** The deck matching an asset's stamped content hash at the current render
   *  settings — the exact identity `insertDeck` enforces, so at most one row.
   *  Lets `tryCacheHit` resolve a duplicate file without re-reading it just to
   *  recompute a digest the asset already carries. */
  findDeckByAssetContent(mediaAssetId: number, renderWidth: number, imageFormat: "webp" | "png"): DeckRow | null {
    const row = this.db
      .select({ deck: slideDecks })
      .from(mediaAssets)
      .innerJoin(
        slideDecks,
        and(
          eq(slideDecks.contentHash, mediaAssets.contentHash),
          eq(slideDecks.renderWidth, renderWidth),
          eq(slideDecks.imageFormat, imageFormat),
        ),
      )
      .where(
        and(
          eq(mediaAssets.id, mediaAssetId),
          sql`${mediaAssets.contentHash} IS NOT NULL`,
          sql`${mediaAssets.contentHashSize} IS ${mediaAssets.sizeBytes}`,
          sql`${mediaAssets.contentHashMtimeMs} IS ${mediaAssets.mtimeMs}`,
        ),
      )
      .get();
    return row?.deck ?? null;
  }

  /** Content-addressed hit: the same bytes converted at the same settings,
   *  even if it arrived through a different library entry or a moved file. */
  findDeckByIdentity(
    contentHash: string,
    renderWidth: number,
    imageFormat: "webp" | "png",
  ): DeckRow | null {
    return (
      this.db
        .select()
        .from(slideDecks)
        .where(
          and(
            eq(slideDecks.contentHash, contentHash),
            eq(slideDecks.renderWidth, renderWidth),
            eq(slideDecks.imageFormat, imageFormat),
          ),
        )
        .get() ?? null
    );
  }

  getDeckById(deckId: number): DeckRow | null {
    return this.db.select().from(slideDecks).where(eq(slideDecks.id, deckId)).get() ?? null;
  }

  listSlides(deckId: number): SlideRow[] {
    return this.db
      .select()
      .from(deckSlides)
      .where(eq(deckSlides.deckId, deckId))
      .orderBy(asc(deckSlides.slideIndex))
      .all();
  }

  listAudio(deckId: number): AudioRow[] {
    return this.db.select().from(deckAudio).where(eq(deckAudio.deckId, deckId)).all();
  }

  // -- writes ---------------------------------------------------------------

  /** Single transaction: a half-inserted deck must never be observable. */
  insertDeck(deck: NewDeck, slides: NewSlide[], audio: NewAudio[]): number {
    const now = Date.now();
    const insert = this.sqlite.transaction(() => {
      // Replace any previous conversion with the same identity (e.g. a forced
      // reconvert) so ux_deck_identity never collides.
      const existing = this.findDeckByIdentity(
        deck.contentHash,
        deck.renderWidth,
        deck.imageFormat,
      );
      if (existing) this.deleteDeckRow(existing.id);

      const deckId = this.db
        .insert(slideDecks)
        .values({
          ...deck,
          slideCount: slides.length,
          status: "ready",
          errorCode: null,
          errorMessage: null,
          createdAt: now,
          updatedAt: now,
          lastUsedAt: deck.lastUsedAt ?? now,
        })
        .run().lastInsertRowid as number;

      // One prepared statement re-run per row, not one statement BUILT and
      // compiled per row: a 400-slide deck used to make Drizzle assemble 400
      // INSERTs inside the transaction.
      const insertSlide = this.insertSlideStmt();
      for (const slide of slides) {
        insertSlide.run(
          deckId,
          slide.slideIndex,
          slide.imageFile,
          slide.thumbFile,
          slide.widthPx,
          slide.heightPx,
          slide.bytes,
          slide.advanceMs,
          slide.advanceOnClick ? 1 : 0,
          slide.transitionMs,
          slide.hidden ? 1 : 0,
          slide.title,
          slide.notes,
        );
      }

      const insertAudio = this.insertAudioStmt();
      for (const track of audio) {
        insertAudio.run(
          deckId,
          track.audioFile,
          track.ext,
          track.bytes,
          track.origin,
          track.scope,
          track.startSlideIndex,
          track.stopSlideIndex,
          track.loop ? 1 : 0,
          track.volume === null ? null : Math.round(track.volume * 100),
          track.playable ? 1 : 0,
        );
      }

      return deckId;
    });

    return insert();
  }

  touchDeck(deckId: number): void {
    this.db
      .update(slideDecks)
      .set({ lastUsedAt: Date.now() })
      .where(eq(slideDecks.id, deckId))
      .run();
  }

  /** Re-points an existing content-addressed deck at the library entry that
   *  just asked for it (the "same file added twice" case).
   *
   *  The source stamp moves with it. The row describes whichever file it is
   *  pointed at, and leaving the previous copy's `(size, mtime)` behind meant
   *  `tryCacheHit`'s first tier — the one that costs a single `statSync` —
   *  could never match again for the new owner: a file merely `touch`ed, or a
   *  duplicate saved at a different moment, fell through to the slower lookup
   *  on every single open, forever. */
  relinkDeck(
    deckId: number,
    mediaAssetId: number,
    sourcePath: string,
    sourceSizeBytes: number,
    sourceMtimeMs: number,
  ): void {
    const now = Date.now();
    this.db
      .update(slideDecks)
      .set({ mediaAssetId, sourcePath, sourceSizeBytes, sourceMtimeMs, lastUsedAt: now, updatedAt: now })
      .where(eq(slideDecks.id, deckId))
      .run();
  }

  setStatus(deckId: number, status: DeckStatus, errorCode?: string, errorMessage?: string): void {
    this.db
      .update(slideDecks)
      .set({
        status: status === "ready" ? "ready" : status === "failed" ? "error" : "converting",
        errorCode: errorCode ?? null,
        errorMessage: errorMessage ?? null,
        updatedAt: Date.now(),
      })
      .where(eq(slideDecks.id, deckId))
      .run();
  }

  private deleteDeckRow(deckId: number): void {
    this.db.delete(slideDecks).where(eq(slideDecks.id, deckId)).run();
  }

  /** Removes the cache directory first, then the row (children CASCADE). A
   *  failed rmSync leaves a row whose files are gone, which self-heals on the
   *  next existence check. */
  deleteDeck(deckId: number): void {
    const row = this.getDeckById(deckId);
    if (row) {
      try {
        fs.rmSync(row.cacheDir, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
    }
    this.deleteDeckRow(deckId);
  }

  // -- cache housekeeping ---------------------------------------------------

  allDeckDirs(): string[] {
    return this.db.select({ dir: slideDecks.cacheDir }).from(slideDecks).all().map((r) => r.dir);
  }

  /** `allDeckDirs().length` used to answer this — every cache path in the
   *  database materialized as a string, to read one number. */
  deckCount(): number {
    const row = this.db
      .select({ n: sql<number>`COUNT(*)` })
      .from(slideDecks)
      .get();
    return row?.n ?? 0;
  }

  totalBytes(): number {
    const row = this.db
      .select({ total: sql<number>`COALESCE(SUM(${slideDecks.bytesOnDisk}), 0)` })
      .from(slideDecks)
      .get();
    return row?.total ?? 0;
  }

  /**
   * Oldest-first eviction candidates, excluding anything recently used or
   * currently on screen.
   *
   * Two columns and a `LIMIT`, not `SELECT *` over every row under the cutoff:
   * eviction only ever needs the id to delete and the bytes to subtract, and
   * it usually stops after the first few. The caller re-asks for another page
   * if it is still over budget — rows it deleted are gone, so the next call
   * naturally continues where this one stopped.
   */
  lruCandidates(
    excludeIds: number[],
    usedBefore: number,
    limit: number,
  ): { id: number; bytesOnDisk: number }[] {
    const base = and(
      lt(slideDecks.lastUsedAt, usedBefore),
      excludeIds.length > 0 ? notInArray(slideDecks.id, excludeIds) : undefined,
    );
    return this.db
      .select({ id: slideDecks.id, bytesOnDisk: slideDecks.bytesOnDisk })
      .from(slideDecks)
      .where(base)
      .orderBy(asc(slideDecks.lastUsedAt))
      .limit(limit)
      .all();
  }

  /** Drops decks left mid-conversion by a crash — a crash skips before-quit,
   *  so this runs at startup instead. */
  deleteUnfinished(): void {
    const rows = this.db
      .select()
      .from(slideDecks)
      .where(sql`${slideDecks.status} IN ('pending','converting')`)
      .all();
    for (const row of rows) this.deleteDeck(row.id);
  }

  // -- timings backfill -----------------------------------------------------

  /**
   * Ready decks converted from a legacy binary that still have at least one
   * slide without an advance time — the population `backfillDeckTimings`
   * re-reads from the source file.
   *
   * `timings_source = 'ooxml-converted'` is the filter that makes the row
   * indexes trustworthy: it is written only when the slide count and the page
   * count lined up, which is exactly the condition under which `deck_slides`
   * row *i* is presentation slide *i*. A `'none'` deck is one where they did
   * NOT line up, and no amount of re-reading fixes an alignment we already
   * know is wrong.
   */
  decksNeedingTimings(): {
    id: number;
    sourcePath: string;
    slideCount: number;
    sourceSizeBytes: number;
    sourceMtimeMs: number;
  }[] {
    return this.sqlite
      .prepare(
        `SELECT d.id AS id, d.source_path AS sourcePath, d.slide_count AS slideCount,
                d.source_size_bytes AS sourceSizeBytes, d.source_mtime_ms AS sourceMtimeMs
           FROM slide_decks d
          WHERE d.status = 'ready'
            AND d.timings_source = 'ooxml-converted'
            AND EXISTS (SELECT 1 FROM deck_slides s
                         WHERE s.deck_id = d.id AND s.advance_ms IS NULL)`,
      )
      .all() as {
      id: number;
      sourcePath: string;
      slideCount: number;
      sourceSizeBytes: number;
      sourceMtimeMs: number;
    }[];
  }

  /** `(slideIndex, advanceMs)` for one deck, in presentation order. */
  slideAdvanceTimes(deckId: number): { slideIndex: number; advanceMs: number | null }[] {
    return this.sqlite
      .prepare(
        `SELECT slide_index AS slideIndex, advance_ms AS advanceMs
           FROM deck_slides WHERE deck_id = ? ORDER BY slide_index`,
      )
      .all(deckId) as { slideIndex: number; advanceMs: number | null }[];
  }

  /** Writes advance times for slides that had none. One transaction, and
   *  `advance_ms IS NULL` in the WHERE so it can never overwrite a value the
   *  conversion already established. */
  fillSlideAdvanceTimes(
    deckId: number,
    updates: readonly { slideIndex: number; advanceMs: number }[],
  ): number {
    if (updates.length === 0) return 0;
    const statement = this.sqlite.prepare(
      `UPDATE deck_slides SET advance_ms = ?
        WHERE deck_id = ? AND slide_index = ? AND advance_ms IS NULL`,
    );
    const run = this.sqlite.transaction(() => {
      let changed = 0;
      for (const update of updates) {
        changed += statement.run(update.advanceMs, deckId, update.slideIndex).changes;
      }
      return changed;
    });
    return run();
  }

  // -- path resolution (worship:// protocol) --------------------------------

  /**
   * The single hottest query in the app: every `<img>` in a slide strip, every
   * thumbnail in the deck transport and every slide the projector paints comes
   * through here. A strip of 400 slides used to be 800 queries — one
   * `getDeckById` plus one slide lookup each — with Drizzle rebuilding both
   * statements every time.
   *
   * One JOIN, prepared once and reused. `slideIndex` is 1-based and in
   * PRESENTATION order, which is what `deck_slides.slide_index` stores.
   */
  getSlideImagePath(deckId: number, slideIndex: number, variant: "full" | "thumb"): string | null {
    const row = this.slideImageStmt().get(deckId, slideIndex) as
      | { cacheDir: string; imageFile: string; thumbFile: string }
      | undefined;
    if (!row) return null;
    return path.join(row.cacheDir, variant === "full" ? row.imageFile : row.thumbFile);
  }

  getAudioPath(audioId: number): string | null {
    const row = this.audioPathStmt().get(audioId) as
      | { cacheDir: string; audioFile: string }
      | undefined;
    if (!row) return null;
    return path.join(row.cacheDir, "audio", row.audioFile);
  }

  // -- DTO ------------------------------------------------------------------

  /** `linkedAudioPath` is resolved by the caller (`deck-service.ts`, via
   *  `MediaRepo`) — this repo only knows about `slide_decks`/`deck_audio`,
   *  never about `media_assets`. */
  toDTO(deckRow: DeckRow, assetId: number, linkedAudioPath: string | null = null): DeckDTO {
    const slideRows = this.listSlides(deckRow.id);
    const audioRows = this.listAudio(deckRow.id);

    // One soundtrack per deck: embedded/transition audio actually inside the
    // file wins (the deck-scoped playable track, else the first playable
    // one), and only when there's none of that do we fall back to a linked
    // external file. Per-slide sound effects are recorded but not projected.
    const embeddedTrack =
      audioRows.find((row) => row.playable === 1 && row.scope === "deck") ??
      audioRows.find((row) => row.playable === 1) ??
      null;

    const soundtrack: DeckDTO["soundtrack"] = embeddedTrack
      ? {
          url: deckAudioUrl(embeddedTrack.id),
          durationMs: null,
          origin: embeddedTrack.origin,
          name: embeddedTrack.audioFile,
        }
      : linkedAudioPath
        ? {
            url: linkedAudioUrl(assetId),
            durationMs: null,
            origin: "linked",
            name: path.basename(linkedAudioPath),
          }
        : null;

    const slides: DeckSlide[] = slideRows.map((row) => ({
      index: row.slideIndex,
      url: slideUrl(deckRow.id, row.slideIndex),
      thumbUrl: slideThumbUrl(deckRow.id, row.slideIndex),
      advanceAfterMs: row.advanceMs,
    }));

    return {
      assetId,
      deckId: deckRow.id,
      status:
        deckRow.status === "ready" ? "ready" : deckRow.status === "error" ? "failed" : "converting",
      slideCount: deckRow.slideCount,
      slides,
      soundtrack,
      autoAdvance: slides.some((slide) => slide.advanceAfterMs !== null),
      timingsSource: deckRow.timingsSource,
      sourceMtimeMs: deckRow.sourceMtimeMs,
      convertedAt: deckRow.updatedAt,
      error: deckRow.errorMessage,
    };
  }
}
