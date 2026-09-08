import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { screen } from "electron";
import {
  SLIDES_CONVERTER_VERSION,
  SLIDES_MAX_RENDER_WIDTH,
  SLIDES_MIN_RENDER_WIDTH,
} from "@shared/constants";
import type { DeckDTO, DeckProgress } from "@shared/types/deck";
import { deckCacheDir, slidesCacheDir, slidesTempDir, sofficeProfileDir } from "../paths";
import { getMediaRepo, getSettingsRepo, getSlidesRepo } from "../services/repos";
import { broadcast } from "../services/broadcast";
import type { DeckRow, NewAudio, NewSlide } from "../db/repositories/slides.repo";
import { SlideError, isSlideError } from "./errors";
import {
  convertTimeoutFor,
  convertToPdf,
  convertToPptx,
  killRunningSoffice,
  locateSoffice,
  resetSofficeProfile,
  warmProfile,
} from "./libreoffice";
import {
  containerKind,
  extractAudioParts,
  readPresentationMeta,
  type PresentationMeta,
} from "./pptx-metadata";
import { rasterizePdf, shutdownRasterizer } from "./rasterizer";

// ---------------------------------------------------------------------------
// Render target
// ---------------------------------------------------------------------------

export type RenderTarget = {
  width: number;
  format: "webp" | "png";
  quality: number;
};

export function resolveRenderTarget(): RenderTarget {
  const settings = getSettingsRepo();
  const configuredMax = settings.get("slides.maxRenderWidth");
  const format = settings.get("slides.imageFormat");

  let physicalWidth = configuredMax;
  try {
    const displays = screen.getAllDisplays();
    const primary = screen.getPrimaryDisplay();
    const preferredId = settings.get("projection.displayId");
    const preferred =
      preferredId !== null ? displays.find((d) => d.id === preferredId) : undefined;
    const target = preferred ?? displays.find((d) => d.id !== primary.id) ?? primary;
    physicalWidth = Math.round(target.bounds.width * target.scaleFactor);
  } catch {
    // screen isn't available before app.whenReady; the configured default is fine.
  }

  const width = Math.min(
    SLIDES_MAX_RENDER_WIDTH,
    Math.max(SLIDES_MIN_RENDER_WIDTH, Math.min(physicalWidth, configuredMax)),
  );
  return { width, format, quality: format === "webp" ? 0.92 : 1 };
}

/** Only re-render when the cached image is meaningfully smaller than the
 *  target — upscaling a 1920 image by 25% is invisible on a projector and not
 *  worth a multi-minute reconversion five minutes before a service. */
function needsRerender(cachedWidth: number, target: RenderTarget): boolean {
  return cachedWidth < target.width * 0.75;
}

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

function hashFile(filePath: string): string {
  const hash = createHash("sha256");
  const fd = fs.openSync(filePath, "r");
  try {
    const buffer = Buffer.alloc(1024 * 1024);
    let bytesRead = 0;
    while ((bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) {
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest("hex");
}

function dirSize(dir: string): number {
  let total = 0;
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else total += fs.statSync(full).size;
    }
  };
  try {
    walk(dir);
  } catch {
    /* best-effort */
  }
  return total;
}

function assertFreeSpace(sourceSize: number): void {
  try {
    const stats = fs.statfsSync(slidesCacheDir);
    const free = stats.bavail * stats.bsize;
    const required = Math.max(500 * 1024 * 1024, sourceSize * 6);
    if (free < required) {
      throw new SlideError(
        "DISK_FULL",
        "No hay suficiente espacio en disco para convertir la presentación.",
      );
    }
  } catch (error) {
    if (isSlideError(error)) throw error;
    // statfsSync isn't available everywhere; not a reason to block.
  }
}

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

const progressByAsset = new Map<number, DeckProgress>();

function emitProgress(next: DeckProgress): void {
  progressByAsset.set(next.assetId, next);
  broadcast("deck-progress", next);
}

export function currentProgress(assetId: number): DeckProgress | null {
  return progressByAsset.get(assetId) ?? null;
}

// ---------------------------------------------------------------------------
// Queue — one conversion at a time
// ---------------------------------------------------------------------------

type Job = {
  assetId: number;
  force: boolean;
  controller: AbortController;
  promise: Promise<DeckDTO>;
  resolve: (dto: DeckDTO) => void;
  reject: (error: unknown) => void;
};

const inFlight = new Map<number, Job>();
const queue: Job[] = [];
let running = false;
let consecutiveTimeouts = 0;

/** LibreOffice isn't reentrant against one UserInstallation, and rasterizing
 *  already saturates a core — so exactly one job runs at a time. */
async function pump(): Promise<void> {
  if (running) return;
  const job = queue.shift();
  if (!job) return;

  running = true;
  try {
    const dto = await runConversion(job);
    job.resolve(dto);
  } catch (error) {
    job.reject(error);
  } finally {
    inFlight.delete(job.assetId);
    running = false;
    void pump();
  }
}

export function cancel(assetId: number): void {
  const job = inFlight.get(assetId);
  if (!job) return;
  job.controller.abort();
  const queued = queue.indexOf(job);
  if (queued >= 0) queue.splice(queued, 1);
}

export function cancelAll(): void {
  for (const job of inFlight.values()) job.controller.abort();
  queue.length = 0;
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

function emptyMeta(): PresentationMeta {
  return { slideCount: 0, slideSizeEmu: null, slides: [], audio: [], skippedVideoParts: [] };
}

/** Assembles the DTO for a `ready` deck row, folding in the asset's *linked*
 *  soundtrack (an external file, resolved per media asset — see
 *  `linked-audio.ts`) as the fallback when the deck itself carries no
 *  embedded/transition audio. Re-resolves the link first so a stale or
 *  never-set `linked_audio_path` (e.g. a library entry added before this
 *  heuristic existed) gets picked up without forcing a reconversion. */
function toDeckDTO(row: DeckRow, assetId: number): DeckDTO {
  const mediaRepo = getMediaRepo();
  mediaRepo.ensureLinkedAudio(assetId);
  return getSlidesRepo().toDTO(row, assetId, mediaRepo.linkedAudioPathById(assetId));
}

/** Reads timings/audio out of the source. Legacy binary .ppt/.pps carry no
 *  OOXML, so they get a second LibreOffice pass to .pptx purely to recover
 *  them — that round-trip preserves advTm and is the difference between parity
 *  and no parity on the old decks churches actually have. */
async function readMetadata(
  sourcePath: string,
  tempDir: string,
  sizeBytes: number,
  signal: AbortSignal,
): Promise<{ meta: PresentationMeta; timingsSource: "ooxml" | "ooxml-converted" | "none"; parsedFrom: string }> {
  const kind = containerKind(sourcePath);

  if (kind === "ooxml") {
    try {
      return { meta: readPresentationMeta(sourcePath), timingsSource: "ooxml", parsedFrom: sourcePath };
    } catch {
      // LibreOffice often recovers files our parser rejects — convert anyway.
      return { meta: emptyMeta(), timingsSource: "none", parsedFrom: sourcePath };
    }
  }

  if (kind === "binary") {
    try {
      const upgradeDir = path.join(tempDir, "upgrade");
      fs.mkdirSync(upgradeDir, { recursive: true });
      const pptx = await convertToPptx({
        sourcePath,
        outDir: upgradeDir,
        timeoutMs: convertTimeoutFor(sizeBytes),
        signal,
      });
      return {
        meta: readPresentationMeta(pptx),
        timingsSource: "ooxml-converted",
        parsedFrom: pptx,
      };
    } catch (error) {
      if (isSlideError(error) && error.slideCode === "CANCELED") throw error;
      // A failed upgrade pass must never block the main conversion.
      console.warn(
        `[slides] .ppt/.pps → .pptx upgrade pass failed, auto-advance and embedded audio disabled for this deck: ${String(error)}`,
      );
      return { meta: emptyMeta(), timingsSource: "none", parsedFrom: sourcePath };
    }
  }

  // .odp stores timings under a different schema (presentation:transition-*),
  // out of scope for now — documented rather than silently wrong.
  return { meta: emptyMeta(), timingsSource: "none", parsedFrom: sourcePath };
}

async function runConversion(job: Job): Promise<DeckDTO> {
  const { assetId, force, controller } = job;
  const signal = controller.signal;
  const slidesRepo = getSlidesRepo();
  const mediaRepo = getMediaRepo();

  const sourcePath = mediaRepo.getPathById(assetId);
  if (!sourcePath) throw new SlideError("SOURCE_MISSING", "No se encontró el archivo en la biblioteca.");
  if (!fs.existsSync(sourcePath)) {
    throw new SlideError("SOURCE_MISSING", `El archivo ya no está disponible: ${sourcePath}`);
  }

  const stat = fs.statSync(sourcePath);
  const target = resolveRenderTarget();

  emitProgress({ assetId, status: "converting", done: 0, total: 0, error: null });

  // 1. Cheapest hit: same asset, same size+mtime, still on disk and current.
  if (!force) {
    const byAsset = slidesRepo.findDeckByAsset(assetId);
    if (
      byAsset &&
      byAsset.status === "ready" &&
      byAsset.sourceSizeBytes === stat.size &&
      byAsset.sourceMtimeMs === Math.trunc(stat.mtimeMs) &&
      byAsset.converterVersion === SLIDES_CONVERTER_VERSION &&
      byAsset.imageFormat === target.format &&
      !needsRerender(byAsset.renderWidth, target) &&
      fs.existsSync(byAsset.cacheDir)
    ) {
      slidesRepo.touchDeck(byAsset.id);
      const dto = toDeckDTO(byAsset, assetId);
      emitProgress({ assetId, status: "ready", done: dto.slideCount, total: dto.slideCount, error: null });
      return dto;
    }
  }

  assertFreeSpace(stat.size);

  // 2. Content-addressed hit: the same bytes, converted through another
  //    library entry or before the file was moved/copied.
  const contentHash = hashFile(sourcePath);
  if (!force) {
    const byIdentity = slidesRepo.findDeckByIdentity(contentHash, target.width, target.format);
    if (
      byIdentity &&
      byIdentity.status === "ready" &&
      byIdentity.converterVersion === SLIDES_CONVERTER_VERSION &&
      fs.existsSync(byIdentity.cacheDir)
    ) {
      slidesRepo.relinkDeck(byIdentity.id, assetId, sourcePath);
      const dto = toDeckDTO({ ...byIdentity, mediaAssetId: assetId }, assetId);
      emitProgress({ assetId, status: "ready", done: dto.slideCount, total: dto.slideCount, error: null });
      return dto;
    }
  }

  // 3. Real conversion, into a temp dir that only becomes the cache dir once
  //    every single file is written.
  const jobDir = path.join(slidesTempDir, randomUUID());
  fs.mkdirSync(jobDir, { recursive: true });

  try {
    const pdfDir = path.join(jobDir, "pdf");
    fs.mkdirSync(pdfDir, { recursive: true });

    // Sequential, not `Promise.all`: for a legacy binary deck, `readMetadata`
    // launches a second `soffice` (the .ppt/.pps → .pptx upgrade pass) — see
    // the serialization comment on `runSoffice` in `libreoffice.ts` for why
    // that no longer races the PDF conversion, but running them one after the
    // other keeps this call site honest about the shared resource either way.
    const metaResult = await readMetadata(sourcePath, jobDir, stat.size, signal);
    const pdfPath = await convertToPdf({
      sourcePath,
      outDir: pdfDir,
      timeoutMs: convertTimeoutFor(stat.size),
      signal,
    });
    consecutiveTimeouts = 0;

    const imagesDir = path.join(jobDir, "images");
    const pages = await rasterizePdf({
      pdfPath,
      outDir: imagesDir,
      targetWidth: target.width,
      format: target.format,
      quality: target.quality,
      signal,
      onPage: (_page, total) =>
        emitProgress({
          assetId,
          status: "converting",
          done: _page.index,
          total,
          error: null,
        }),
    });

    if (pages.length === 0) {
      throw new SlideError("RASTER_FAILED", "La presentación no produjo ninguna diapositiva.");
    }

    // LibreOffice does NOT export hidden slides to the PDF (verified against a
    // real deck), so the PDF pages line up with the VISIBLE slides — matching
    // against the full OOXML list would shift every timing by one per hidden
    // slide. Counts can still disagree for other reasons (an animated slide
    // split across pages), and in that case timings are dropped entirely:
    // silently misaligned auto-advance is far worse than none at all.
    const { meta, timingsSource } = metaResult;
    const visibleSlides = meta.slides.filter((slide) => !slide.hidden);
    const timingsUsable = timingsSource !== "none" && visibleSlides.length === pages.length;
    const effectiveTimingsSource = timingsUsable ? timingsSource : "none";

    if (timingsSource !== "none" && !timingsUsable) {
      console.warn(
        `[slides] timing/page count mismatch (${visibleSlides.length} visible slides vs ${pages.length} pages) — auto-advance disabled for this deck`,
      );
    }

    const slides: NewSlide[] = pages.map((page) => {
      const timing = timingsUsable ? visibleSlides[page.index - 1] : undefined;
      return {
        slideIndex: page.index,
        imageFile: page.file,
        thumbFile: page.thumbFile,
        widthPx: page.widthPx,
        heightPx: page.heightPx,
        bytes: page.bytes,
        advanceMs: timing?.autoAdvanceMs ?? null,
        advanceOnClick: timing?.advanceOnClick ?? true,
        transitionMs: timing?.transitionMs ?? null,
        hidden: timing?.hidden ?? false,
        title: timing?.title ?? null,
        notes: timing?.notes ?? null,
      };
    });

    // Audio embedded in the file itself, independent of whether the timings
    // lined up — a deck with mismatched slide/page counts still loses only
    // its auto-advance, not its soundtrack. The other audio source (a linked
    // sibling file, e.g. an old hymnal's external .mp3) is deliberately NOT
    // handled here: `slide_decks` is keyed by content hash and shared across
    // library entries, but a sibling file depends on the *folder* the source
    // currently lives in — baking it into the cache would let the first
    // conversion's folder impose its audio on every other entry that happens
    // to share the same deck bytes. It lives on `media_assets.linkedAudioPath`
    // instead and is resolved per-asset (see `linked-audio.ts` and
    // `MediaRepo.ensureLinkedAudio`), served by reference, never copied.
    const audioDir = path.join(jobDir, "audio");
    const audio: NewAudio[] = [];

    if (meta.audio.length > 0) {
      for (const extracted of extractAudioParts(metaResult.parsedFrom, meta.audio, audioDir)) {
        audio.push({
          audioFile: extracted.file,
          ext: extracted.ext,
          bytes: extracted.bytes,
          origin: extracted.origin,
          scope: extracted.scope,
          startSlideIndex: extracted.startSlideIndex,
          stopSlideIndex: null,
          loop: extracted.loop,
          volume: extracted.volume,
          playable: extracted.playable,
        });
      }
    }

    if (meta.skippedVideoParts.length > 0) {
      console.info(
        `[slides] ${meta.skippedVideoParts.length} embedded video part(s) skipped (out of scope): ${meta.skippedVideoParts.join(", ")}`,
      );
    }

    // Commit: move the finished artifacts into place, then insert in one tx.
    const finalDir = deckCacheDir(contentHash, target.width, target.format);
    fs.rmSync(finalDir, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(finalDir), { recursive: true });
    fs.renameSync(imagesDir, finalDir);
    if (fs.existsSync(audioDir)) {
      fs.renameSync(audioDir, path.join(finalDir, "audio"));
    }

    const aspectRatio = meta.slideSizeEmu
      ? `${meta.slideSizeEmu.cx}:${meta.slideSizeEmu.cy}`
      : null;

    const deckId = getSlidesRepo().insertDeck(
      {
        contentHash,
        renderWidth: target.width,
        imageFormat: target.format,
        converterVersion: SLIDES_CONVERTER_VERSION,
        mediaAssetId: assetId,
        sourcePath,
        sourceSizeBytes: stat.size,
        sourceMtimeMs: Math.trunc(stat.mtimeMs),
        cacheDir: finalDir,
        aspectRatio,
        timingsSource: effectiveTimingsSource,
        bytesOnDisk: dirSize(finalDir),
      },
      slides,
      audio,
    );

    const row = getSlidesRepo().getDeckById(deckId);
    if (!row) throw new SlideError("RASTER_FAILED", "No se pudo leer el deck recién creado.");

    const dto = toDeckDTO(row, assetId);
    emitProgress({ assetId, status: "ready", done: dto.slideCount, total: dto.slideCount, error: null });
    evictIfOverCap();
    return dto;
  } catch (error) {
    if (isSlideError(error) && error.slideCode === "SOFFICE_TIMEOUT") {
      consecutiveTimeouts += 1;
      // A profile our own killed process left locked keeps timing out forever.
      if (consecutiveTimeouts >= 2) {
        resetSofficeProfile();
        consecutiveTimeouts = 0;
      }
    }
    const message = error instanceof Error ? error.message : String(error);
    emitProgress({
      assetId,
      status: isSlideError(error) && error.slideCode === "CANCELED" ? "stale" : "failed",
      done: 0,
      total: 0,
      error: message,
    });
    throw error;
  } finally {
    // A failure never leaves garbage behind.
    fs.rmSync(jobDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Cache-only read: safe to call while merely rendering a list. */
export function getDeck(assetId: number): DeckDTO | null {
  const repo = getSlidesRepo();
  const row = repo.findDeckByAsset(assetId);
  if (!row || row.status !== "ready") return null;
  if (!fs.existsSync(row.cacheDir)) return null;
  return toDeckDTO(row, assetId);
}

/** Idempotent per assetId: a second call while a conversion is in flight joins
 *  the same job rather than queuing another (the preview effect and "EN VIVO"
 *  can fire within milliseconds of each other). */
export function prepareDeck(assetId: number, force = false): Promise<DeckDTO> {
  const existing = inFlight.get(assetId);
  if (existing) return existing.promise;

  let resolve!: (dto: DeckDTO) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<DeckDTO>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  const job: Job = { assetId, force, controller: new AbortController(), promise, resolve, reject };
  inFlight.set(assetId, job);
  queue.push(job);
  void pump();
  return promise;
}

export function cacheStats(): { deckCount: number; bytesOnDisk: number; maxBytes: number } {
  const repo = getSlidesRepo();
  return {
    deckCount: repo.allDeckDirs().length,
    bytesOnDisk: repo.totalBytes(),
    maxBytes: getSettingsRepo().get("slides.cacheMaxMb") * 1024 * 1024,
  };
}

/** Deck ids that must never be evicted (currently projected). */
const pinnedDeckIds = new Set<number>();

export function pinDeck(deckId: number | null): void {
  pinnedDeckIds.clear();
  if (deckId !== null) pinnedDeckIds.add(deckId);
}

export function evictIfOverCap(): void {
  const repo = getSlidesRepo();
  const maxBytes = getSettingsRepo().get("slides.cacheMaxMb") * 1024 * 1024;
  let total = repo.totalBytes();
  if (total <= maxBytes) return;

  const graceCutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const row of repo.lruCandidates([...pinnedDeckIds], graceCutoff)) {
    if (total <= maxBytes) break;
    total -= row.bytesOnDisk;
    repo.deleteDeck(row.id);
  }
}

/** Startup housekeeping: a crash skips before-quit entirely, so orphan and
 *  half-finished state is reconciled here rather than on shutdown. */
export function sweepCache(): void {
  const repo = getSlidesRepo();

  fs.rmSync(slidesTempDir, { recursive: true, force: true });
  fs.mkdirSync(slidesTempDir, { recursive: true });

  repo.deleteUnfinished();

  const known = new Set(repo.allDeckDirs());
  try {
    for (const entry of fs.readdirSync(slidesCacheDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === ".tmp") continue;
      const full = path.join(slidesCacheDir, entry.name);
      if (!known.has(full)) fs.rmSync(full, { recursive: true, force: true });
    }
  } catch {
    /* best-effort */
  }
}

export async function initSlidesSubsystem(): Promise<void> {
  for (const dir of [slidesCacheDir, slidesTempDir, sofficeProfileDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }

  try {
    sweepCache();
    evictIfOverCap();
  } catch (error) {
    console.warn("[slides] cache sweep failed", error);
  }

  await locateSoffice({ force: true });
  await warmProfile();
}

export function shutdownSlides(): void {
  cancelAll();
  killRunningSoffice();
  shutdownRasterizer();
}
