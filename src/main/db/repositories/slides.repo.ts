import fs from "node:fs";
import path from "node:path";
import { and, asc, eq, lt, notInArray, sql } from "drizzle-orm";
import type Database from "better-sqlite3";
import type { Db } from "../client";
import { deckAudio, deckSlides, slideDecks } from "../schema";
import { slideThumbUrl, slideUrl, deckAudioUrl } from "@shared/urls";
import type { DeckDTO, DeckSlide, DeckStatus } from "@shared/types/deck";

type DeckRow = typeof slideDecks.$inferSelect;
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
  origin: "embedded" | "transition" | "linked-sibling";
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
          lastUsedAt: now,
        })
        .run().lastInsertRowid as number;

      for (const slide of slides) {
        this.db
          .insert(deckSlides)
          .values({
            deckId,
            slideIndex: slide.slideIndex,
            imageFile: slide.imageFile,
            thumbFile: slide.thumbFile,
            widthPx: slide.widthPx,
            heightPx: slide.heightPx,
            bytes: slide.bytes,
            advanceMs: slide.advanceMs,
            advanceOnClick: slide.advanceOnClick ? 1 : 0,
            transitionMs: slide.transitionMs,
            hidden: slide.hidden ? 1 : 0,
            title: slide.title,
            notes: slide.notes,
          })
          .run();
      }

      for (const track of audio) {
        this.db
          .insert(deckAudio)
          .values({
            deckId,
            audioFile: track.audioFile,
            ext: track.ext,
            bytes: track.bytes,
            origin: track.origin,
            scope: track.scope,
            startSlideIndex: track.startSlideIndex,
            stopSlideIndex: track.stopSlideIndex,
            loop: track.loop ? 1 : 0,
            volume: track.volume === null ? null : Math.round(track.volume * 100),
            playable: track.playable ? 1 : 0,
          })
          .run();
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
   *  just asked for it (the "same file added twice" case). */
  relinkDeck(deckId: number, mediaAssetId: number, sourcePath: string): void {
    this.db
      .update(slideDecks)
      .set({ mediaAssetId, sourcePath, lastUsedAt: Date.now(), updatedAt: Date.now() })
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

  totalBytes(): number {
    const row = this.db
      .select({ total: sql<number>`COALESCE(SUM(${slideDecks.bytesOnDisk}), 0)` })
      .from(slideDecks)
      .get();
    return row?.total ?? 0;
  }

  /** Oldest-first eviction candidates, excluding anything recently used or
   *  currently on screen. */
  lruCandidates(excludeIds: number[], usedBefore: number): DeckRow[] {
    const base = and(
      lt(slideDecks.lastUsedAt, usedBefore),
      excludeIds.length > 0 ? notInArray(slideDecks.id, excludeIds) : undefined,
    );
    return this.db
      .select()
      .from(slideDecks)
      .where(base)
      .orderBy(asc(slideDecks.lastUsedAt))
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

  // -- path resolution (worship:// protocol) --------------------------------

  getSlideImagePath(deckId: number, slideIndex: number, variant: "full" | "thumb"): string | null {
    const deck = this.getDeckById(deckId);
    if (!deck) return null;
    const slide = this.db
      .select()
      .from(deckSlides)
      .where(and(eq(deckSlides.deckId, deckId), eq(deckSlides.slideIndex, slideIndex)))
      .get();
    if (!slide) return null;
    return path.join(deck.cacheDir, variant === "full" ? slide.imageFile : slide.thumbFile);
  }

  getAudioPath(audioId: number): string | null {
    const track = this.db.select().from(deckAudio).where(eq(deckAudio.id, audioId)).get();
    if (!track) return null;
    const deck = this.getDeckById(track.deckId);
    if (!deck) return null;
    return path.join(deck.cacheDir, "audio", track.audioFile);
  }

  // -- DTO ------------------------------------------------------------------

  toDTO(deckRow: DeckRow, assetId: number): DeckDTO {
    const slideRows = this.listSlides(deckRow.id);
    const audioRows = this.listAudio(deckRow.id);

    const slides: DeckSlide[] = slideRows.map((row) => ({
      index: row.slideIndex,
      url: slideUrl(deckRow.id, row.slideIndex),
      thumbUrl: slideThumbUrl(deckRow.id, row.slideIndex),
      advanceAfterMs: row.advanceMs,
    }));

    // One soundtrack per deck: the deck-scoped playable track, else the first
    // playable one. Per-slide sound effects are recorded but not projected.
    const track =
      audioRows.find((row) => row.playable === 1 && row.scope === "deck") ??
      audioRows.find((row) => row.playable === 1) ??
      null;

    return {
      assetId,
      deckId: deckRow.id,
      status:
        deckRow.status === "ready" ? "ready" : deckRow.status === "error" ? "failed" : "converting",
      slideCount: deckRow.slideCount,
      slides,
      soundtrack: track ? { url: deckAudioUrl(track.id), durationMs: null } : null,
      autoAdvance: slides.some((slide) => slide.advanceAfterMs !== null),
      sourceMtimeMs: deckRow.sourceMtimeMs,
      convertedAt: deckRow.updatedAt,
      error: deckRow.errorMessage,
    };
  }
}
