import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { convertedMediaDir } from "../paths";
import { renameWithRetry } from "../fs-retry";
import { getConversionsRepo } from "../services/repos";
import { broadcast } from "../services/broadcast";
import type { ConversionCandidate } from "../db/repositories/conversions.repo";
import { FfmpegError, encoderThreads, ffmpegAvailable, killAllFfmpeg, probeMedia, runFfmpeg } from "./ffmpeg";
import {
  MEDIA_PROBE_VERSION,
  conversionArgs,
  encodeEverything,
  normalizeProbe,
  parseProbe,
  parseProgress,
  planCopiesAnything,
  planPlayback,
  type MediaProbe,
  type PlaybackPlan,
} from "./media-compat";
import type { DecoderSupport, MediaConversionState, MediaConversionUpdate } from "@shared/types/media";

/**
 * Makes every video and audio in the library playable, by converting the ones
 * Chromium cannot decode into a copy it can (`media-compat.ts` decides which).
 *
 * The operator's decisions (2026-10-18) shape it: every file that enters the
 * app — imported or merely seen in a linked folder — is checked, and converted
 * in the background right away, one at a time, so it is ready by the service.
 * The original is never touched. The copy is served behind the same
 * `worship://asset/<id>`, but only to a url that carries its `version` (the
 * copy's file name, `?v=`): the bare url always means the original. That is
 * what keeps an element that started on the original — a native-looking file
 * projected before its probe finished — from being handed the copy's bytes
 * mid-play, and what gives a renderer a new url when the bytes change
 * (`.claude/knowledge/chromium-reuses-a-media-urls-data-across-elements-so-changed-bytes-need-a-changed-url.md`).
 *
 * What is persisted is only facts (the probe) and results (the output file);
 * see `media_conversions` in `schema.ts` for why the decision itself is not.
 * Queue and progress live here, in memory, and are rebuilt every launch by
 * `reconcile()` — which is also everything that ever enqueues work.
 *
 * Reconciling waits for `setDecoderSupport`: until the control window has said
 * whether this GPU decodes HEVC, nothing can be decided about an HEVC file.
 */

/** Extensions Chromium opens at all. A file with any other one is shown as
 *  queued the moment it is seen, before ffprobe has looked at it, and is
 *  probed first — an AVI dropped on the library says "Convirtiendo" at once
 *  instead of after the rest of a 300-file folder has been probed. */
const LIKELY_NATIVE_EXT = new Set([
  ...["mp4", "m4v", "mov", "3gp", "mkv", "webm", "ogv"],
  ...["mp3", "m4a", "aac", "wav", "ogg", "oga", "opus", "flac", "weba"],
]);

/** ≤4 progress pushes a second per conversion. */
const PROGRESS_INTERVAL_MS = 250;
/** Coalesces the burst of "the library changed" calls an import makes. */
const RECONCILE_DEBOUNCE_MS = 300;

let decoders: DecoderSupport | null = null;
/** Only assets that cannot play yet. Absent = playable. */
const states = new Map<number, MediaConversionState>();
/** The playable copy of each converted asset — the token its url carries. */
const versions = new Map<number, string>();
const queue: number[] = [];
/** Asked for by the operator before it was even queued (the PREVIEW of a file
 *  still waiting for its probe): goes to the front once it is. */
const prioritized = new Set<number>();
/** Rows whose probe said "unreadable", re-probed once this launch: a timeout
 *  or a file still being copied must not be taken for a broken file forever. */
const reprobed = new Set<number>();
let current: { assetId: number; abort: AbortController } | null = null;
let reconciling = false;
let reconcileAgain = false;
let reconcileTimer: NodeJS.Timeout | null = null;
let shutDown = false;

function publish(assetId: number): void {
  broadcast("conversion-changed", {
    assetId,
    state: states.get(assetId) ?? null,
    version: versions.get(assetId) ?? null,
  });
}

/** `undefined` leaves that half as it is. Broadcasts only a real change. */
function update(
  assetId: number,
  next: { state?: MediaConversionState | null; version?: string | null },
): void {
  let changed = false;
  if (next.state !== undefined) {
    const before = states.get(assetId);
    if (next.state === null) changed = states.delete(assetId) || changed;
    else if (JSON.stringify(before) !== JSON.stringify(next.state)) {
      states.set(assetId, next.state);
      changed = true;
    }
  }
  if (next.version !== undefined && (versions.get(assetId) ?? null) !== next.version) {
    if (next.version === null) versions.delete(assetId);
    else versions.set(assetId, next.version);
    changed = true;
  }
  if (changed) publish(assetId);
}

function setState(assetId: number, state: MediaConversionState | null): void {
  update(assetId, { state });
}

function probeIsCurrent(c: ConversionCandidate): boolean {
  return (
    c.conversion !== null &&
    c.conversion.probeVersion === MEDIA_PROBE_VERSION &&
    c.conversion.sourceSize === c.sizeBytes &&
    c.conversion.sourceMtimeMs === c.mtimeMs
  );
}

function storedProbe(c: ConversionCandidate): MediaProbe | null {
  if (!c.conversion?.probeJson) return null;
  try {
    return normalizeProbe(JSON.parse(c.conversion.probeJson));
  } catch {
    return null;
  }
}

function outputExists(file: string | null | undefined): file is string {
  return typeof file === "string" && fs.existsSync(path.join(convertedMediaDir, file));
}

function dequeue(assetId: number): void {
  const index = queue.indexOf(assetId);
  if (index !== -1) queue.splice(index, 1);
}

function enqueue(assetId: number): void {
  if (current?.assetId === assetId || queue.includes(assetId)) return;
  if (prioritized.delete(assetId)) queue.unshift(assetId);
  else queue.push(assetId);
  setState(assetId, { status: "queued" });
  pump();
}

/** One candidate whose probe is current: playable as it is, already converted,
 *  or work to do. */
function consider(c: ConversionCandidate, caps: DecoderSupport): void {
  const probe = storedProbe(c);
  // ffprobe could not read it. Converting cannot help either, and the
  // projector already reports a file it cannot open.
  if (!probe) {
    if (current?.assetId !== c.id) update(c.id, { state: null, version: null });
    return;
  }
  const plan = planPlayback(probe, c.kind, caps);
  if (plan.kind === "native") {
    // Converted on a machine whose GPU could not decode it, and this one can:
    // the copy is a downgrade (1080p cap), and it is disk nobody needs.
    if (c.conversion?.outputFile) {
      getConversionsRepo().setOutput(c.id, null);
      void fsp.rm(path.join(convertedMediaDir, c.conversion.outputFile), { force: true }).catch(() => undefined);
    }
    update(c.id, { state: null, version: null });
    return;
  }
  if (outputExists(c.conversion?.outputFile)) {
    update(c.id, { state: null, version: c.conversion.outputFile });
    return;
  }
  // A failure waits for "Reintentar" or the next launch, never loops.
  if (states.get(c.id)?.status === "failed") return;
  enqueue(c.id);
}

async function probeAndRecord(c: ConversionCandidate): Promise<ConversionCandidate | null> {
  let stat: fs.Stats;
  try {
    stat = await fsp.stat(c.path);
  } catch {
    // Vanished since the library saw it; the sweep will mark it missing.
    return null;
  }
  const probe = parseProbe(await probeMedia(c.path));
  // Stamped with what the LIBRARY believes about the file when it has an
  // answer, so the stamp matches the row and this does not re-probe on every
  // reconcile until the sweep catches up with an edit.
  const sourceSize = c.sizeBytes ?? stat.size;
  const sourceMtimeMs = c.mtimeMs ?? Math.trunc(stat.mtimeMs);
  const probeJson = probe ? JSON.stringify(probe) : null;
  try {
    getConversionsRepo().recordProbe(c.id, sourceSize, sourceMtimeMs, MEDIA_PROBE_VERSION, probeJson);
  } catch (error) {
    // The asset was deleted (or merged away by a relocate) while ffprobe ran:
    // its FK is gone. One file, not the whole pass.
    console.warn(`[convert] could not record the probe of ${c.path}`, error);
    return null;
  }
  return {
    ...c,
    conversion: { sourceSize, sourceMtimeMs, probeVersion: MEDIA_PROBE_VERSION, probeJson, outputFile: null },
  };
}

async function reconcileOnce(caps: DecoderSupport): Promise<void> {
  const candidates = getConversionsRepo().candidates();

  // Removed or gone missing since the last pass.
  const present = new Set(candidates.map((c) => c.id));
  for (const id of [...queue]) if (!present.has(id)) dequeue(id);
  for (const id of new Set([...states.keys(), ...versions.keys()])) {
    if (!present.has(id) && current?.assetId !== id) update(id, { state: null, version: null });
  }

  if (!ffmpegAvailable()) {
    for (const c of candidates) {
      if (!LIKELY_NATIVE_EXT.has(c.ext)) setState(c.id, { status: "failed", errorCode: "FFMPEG_MISSING" });
    }
    return;
  }

  const unknown: ConversionCandidate[] = [];
  for (const c of candidates) {
    const unreadable = probeIsCurrent(c) && c.conversion?.probeJson === null;
    if (probeIsCurrent(c) && !(unreadable && !reprobed.has(c.id))) consider(c, caps);
    else {
      if (unreadable) reprobed.add(c.id);
      unknown.push(c);
    }
  }
  // What the operator is looking at first, then suspicious extensions — and
  // those are shown as queued before their turn.
  const rank = (c: ConversionCandidate) => (prioritized.has(c.id) ? 0 : LIKELY_NATIVE_EXT.has(c.ext) ? 2 : 1);
  unknown.sort((a, b) => rank(a) - rank(b));
  for (const c of unknown) {
    if (!LIKELY_NATIVE_EXT.has(c.ext) && !states.has(c.id)) setState(c.id, { status: "queued" });
  }
  for (const c of unknown) {
    if (shutDown) return;
    const probed = await probeAndRecord(c);
    if (probed) consider(probed, caps);
    else setState(c.id, null);
  }
}

async function reconcile(): Promise<void> {
  if (shutDown || decoders === null) return;
  if (reconciling) {
    reconcileAgain = true;
    return;
  }
  reconciling = true;
  try {
    do {
      reconcileAgain = false;
      await reconcileOnce(decoders);
    } while (reconcileAgain && !shutDown);
  } catch (error) {
    console.warn("[convert] reconcile failed", error);
  } finally {
    reconciling = false;
  }
}

function scheduleReconcile(delayMs = RECONCILE_DEBOUNCE_MS): void {
  if (shutDown) return;
  if (reconcileTimer) clearTimeout(reconcileTimer);
  reconcileTimer = setTimeout(() => {
    reconcileTimer = null;
    void reconcile();
  }, delayMs);
}

async function convert(assetId: number, signal: AbortSignal, caps: DecoderSupport): Promise<void> {
  const repo = getConversionsRepo();
  const c = repo.candidates(assetId)[0];
  const probe = c ? storedProbe(c) : null;
  if (!c?.conversion || !probe || !probeIsCurrent(c)) {
    // Removed, gone missing or edited while it waited: the next pass decides.
    setState(assetId, null);
    scheduleReconcile();
    return;
  }
  const stamp = { size: c.conversion.sourceSize, mtimeMs: c.conversion.sourceMtimeMs };
  let plan: PlaybackPlan = planPlayback(probe, c.kind, caps);
  if (plan.kind === "native") {
    setState(assetId, null);
    return;
  }
  if (!fs.existsSync(c.path)) {
    setState(assetId, { status: "failed", errorCode: "SOURCE_MISSING" });
    return;
  }

  // Named by its stamp, so an edited source gets a new file instead of
  // overwriting one a player may be reading.
  const outputFile = `${assetId}-${stamp.size}-${stamp.mtimeMs}.${c.kind === "audio" ? "m4a" : "mp4"}`;
  const finalPath = path.join(convertedMediaDir, outputFile);
  const partPath = `${finalPath}.part`;

  let lastReportAt = 0;
  const onProgressChunk = (chunk: string) => {
    const progress = parseProgress(chunk, probe.durationSec);
    const now = Date.now();
    if (progress === null || now - lastReportAt < PROGRESS_INTERVAL_MS) return;
    lastReportAt = now;
    setState(assetId, { status: "converting", progress });
  };

  const run = (p: Extract<PlaybackPlan, { kind: "convert" }>) =>
    runFfmpeg(conversionArgs(c.path, partPath, probe, p, encoderThreads()), { signal, onProgressChunk });

  setState(assetId, { status: "converting", progress: null });
  const startedAt = Date.now();
  try {
    await fsp.mkdir(convertedMediaDir, { recursive: true });
    try {
      await run(plan);
    } catch (error) {
      // A remux that failed (AVI timestamps the MP4 muxer rejects) gets one
      // more chance as a full encode, which does not depend on them.
      if (!(error instanceof FfmpegError) || error.code === "CANCELED" || !planCopiesAnything(plan)) throw error;
      console.warn(`[convert] remux failed, re-encoding: ${c.path}`, error.message);
      plan = encodeEverything(plan);
      if (plan.kind === "native") throw error;
      await run(plan);
    }
    await renameWithRetry(partPath, finalPath);
    // Only onto the bytes it was made from: a file still being copied into a
    // linked folder can change under ffmpeg, and its next probe re-stamps the
    // row. A copy of the old bytes written onto the new stamp would be served
    // as the new file from then on, across launches.
    if (!repo.setOutputIfStamped(assetId, stamp.size, stamp.mtimeMs, outputFile)) {
      await fsp.rm(finalPath, { force: true }).catch(() => undefined);
      setState(assetId, null);
      scheduleReconcile();
      return;
    }
    console.info(`[convert] ${c.path} → ${outputFile} in ${((Date.now() - startedAt) / 1000).toFixed(1)} s`);
    update(assetId, { state: null, version: outputFile });
  } catch (error) {
    await fsp.rm(partPath, { force: true }).catch(() => undefined);
    // Whoever canceled it owns its state (a removed asset, a quit).
    if (error instanceof FfmpegError && error.code === "CANCELED") return;
    console.warn(`[convert] failed: ${c.path}`, error);
    setState(assetId, { status: "failed", errorCode: "CONVERSION_FAILED" });
  }
}

function pump(): void {
  if (shutDown || current || decoders === null) return;
  const assetId = queue.shift();
  if (assetId === undefined) return;
  const abort = new AbortController();
  current = { assetId, abort };
  void convert(assetId, abort.signal, decoders).finally(() => {
    current = null;
    pump();
  });
}

/** Deletes interrupted `.part` files and copies no row points at (an edited
 *  source's previous copy, a removed asset's). Startup only: at runtime a file
 *  can exist for a moment before its row is written. */
async function sweepConvertedMedia(): Promise<void> {
  let names: string[];
  try {
    names = await fsp.readdir(convertedMediaDir);
  } catch {
    return; // Nothing converted yet.
  }
  const kept = getConversionsRepo().outputFiles();
  let removed = 0;
  for (const name of names) {
    if (kept.has(name)) continue;
    await fsp.rm(path.join(convertedMediaDir, name), { force: true, recursive: true }).catch(() => undefined);
    removed += 1;
  }
  if (removed > 0) console.info(`[convert] swept ${removed} stale file(s)`);
}

export function initConversions(): void {
  void sweepConvertedMedia().catch((error: unknown) => console.warn("[convert] sweep failed", error));
  if (!ffmpegAvailable()) console.warn("[convert] bundled FFmpeg not found — run scripts/fetch-ffmpeg.ts");
}

/** From the control window at startup. The first report starts everything; a
 *  later identical one (a reloaded renderer) changes nothing. */
export function setDecoderSupport(caps: DecoderSupport): void {
  const changed = decoders === null || decoders.hevc !== caps.hevc || decoders.hevcMain10 !== caps.hevcMain10;
  decoders = caps;
  if (changed) scheduleReconcile(0);
  else pump();
}

/** What the control window reported, or null before its first report. */
export function currentDecoderSupport(): DecoderSupport | null {
  return decoders;
}

/** Something about the library's videos or audios may have changed. */
export function notifyMediaChanged(): void {
  scheduleReconcile();
}

/** Every asset that cannot play yet, and every one that plays through a copy. */
export function listConversions(): MediaConversionUpdate[] {
  return [...new Set([...states.keys(), ...versions.keys()])].map((assetId) => ({
    assetId,
    state: states.get(assetId) ?? null,
    version: versions.get(assetId) ?? null,
  }));
}

/** The operator is looking at it: it goes next — or, if it is still waiting
 *  for its probe, as soon as it is queued. */
export function prioritizeConversion(assetId: number): void {
  const index = queue.indexOf(assetId);
  if (index === 0 || current?.assetId === assetId) return;
  if (index === -1) {
    prioritized.add(assetId);
    return;
  }
  queue.splice(index, 1);
  queue.unshift(assetId);
}

export function retryConversion(assetId: number): void {
  if (states.get(assetId)?.status !== "failed") return;
  // Through `update`, so the renderer hears it even if nothing re-queues it.
  setState(assetId, null);
  if (decoders === null) return;
  const c = getConversionsRepo().candidates(assetId)[0];
  if (!c || !probeIsCurrent(c)) {
    scheduleReconcile(0);
    return;
  }
  prioritized.add(assetId);
  consider(c, decoders);
}

/** The asset was deleted: stop whatever is being done for it. Its file is
 *  collected by the next startup sweep. */
export function forgetConversion(assetId: number): void {
  dequeue(assetId);
  prioritized.delete(assetId);
  if (current?.assetId === assetId) current.abort.abort();
  update(assetId, { state: null, version: null });
}

/** What `worship://asset/<id>` serves to a url that carries a copy's version:
 *  the current copy, or nothing (the caller then serves the original). A url
 *  with no version always gets the original — see the note at the top. */
export function convertedPathFor(assetId: number, version: string | null): string | null {
  if (version === null) return null;
  const file = getConversionsRepo().outputFor(assetId);
  // A bare name by construction; asserted where bytes leave the process.
  if (!file || path.basename(file) !== file) return null;
  return path.join(convertedMediaDir, file);
}

/** `before-quit`: synchronous, like every other shutdown chore. */
export function shutdownConversions(): void {
  shutDown = true;
  if (reconcileTimer) clearTimeout(reconcileTimer);
  queue.length = 0;
  current?.abort.abort();
  killAllFfmpeg();
}
