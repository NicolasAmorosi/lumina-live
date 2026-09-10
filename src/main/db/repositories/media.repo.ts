import fs from "node:fs";
import path from "node:path";
import { eq, and } from "drizzle-orm";
import Database from "better-sqlite3";
import type { Db } from "../client";
import { mediaAssets } from "../schema";
import { LINKED_AUDIO_RESOLVER_VERSION, type AssetKind } from "@shared/constants";
import type { MediaAsset } from "@shared/types/media";
import { resolveLinkedAudio } from "../../slides/linked-audio";
import { IpcError } from "@shared/ipc/result";

function toPathKey(filePath: string): string {
  const normalized = path.normalize(filePath).normalize("NFC");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function toDTO(row: typeof mediaAssets.$inferSelect): MediaAsset {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    ext: row.ext,
    path: row.path,
    sizeBytes: row.sizeBytes,
    durationMs: row.durationMs,
    linkedAudioPath: row.linkedAudioPath,
    inLibrary: row.inLibrary === 1,
    missingSince: row.missingSince,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Resolves the audio a legacy `.ppt`/`.pps` deck points at (or sits next to)
 *  — see `linked-audio.ts` for the three-rule heuristic. Kept as a thin
 *  re-export here so callers that only know about "media assets" don't need
 *  to reach into `slides/`. */
export function findLinkedAudio(filePath: string): string | null {
  return resolveLinkedAudio(filePath);
}

export class MediaRepo {
  constructor(private readonly db: Db) {}

  list(kind: AssetKind): MediaAsset[] {
    return this.db
      .select()
      .from(mediaAssets)
      .where(and(eq(mediaAssets.kind, kind), eq(mediaAssets.inLibrary, 1)))
      .all()
      .map(toDTO);
  }

  /** Adds a file if new, or reactivates it in the library if it already exists (e.g. was
   *  referenced by a program but not shown in the library list). */
  upsertFromPath(filePath: string, kind: AssetKind, inLibrary: boolean): MediaAsset {
    const stat = fs.statSync(filePath);
    const pathKey = toPathKey(filePath);
    const now = Date.now();
    const existing = this.db
      .select()
      .from(mediaAssets)
      .where(eq(mediaAssets.pathKey, pathKey))
      .get();

    if (existing) {
      this.db
        .update(mediaAssets)
        .set({
          inLibrary: inLibrary || existing.inLibrary === 1 ? 1 : 0,
          missingSince: null,
          lastSeenAt: now,
          sizeBytes: stat.size,
          mtimeMs: Math.trunc(stat.mtimeMs),
          updatedAt: now,
        })
        .where(eq(mediaAssets.id, existing.id))
        .run();
      return toDTO({ ...existing, inLibrary: inLibrary ? 1 : existing.inLibrary });
    }

    const ext = path.extname(filePath).slice(1).toLowerCase();
    const name = path.basename(filePath, path.extname(filePath));
    const linkedAudioPath = kind === "ppt" ? findLinkedAudio(filePath) : null;

    const id = this.db
      .insert(mediaAssets)
      .values({
        kind,
        path: filePath,
        pathKey,
        name,
        ext,
        sizeBytes: stat.size,
        mtimeMs: Math.trunc(stat.mtimeMs),
        linkedAudioPath,
        // Already resolved above at the current rules — mark it so
        // `ensureLinkedAudio` doesn't immediately redo the same I/O the
        // first time this deck is opened.
        linkedAudioResolvedVersion: kind === "ppt" ? LINKED_AUDIO_RESOLVER_VERSION : 0,
        inLibrary: inLibrary ? 1 : 0,
        lastSeenAt: now,
        missingSince: null,
        createdAt: now,
        updatedAt: now,
      })
      .run().lastInsertRowid as number;

    const row = this.db.select().from(mediaAssets).where(eq(mediaAssets.id, id)).get();
    if (!row) throw new Error("Failed to read back inserted media asset");
    return toDTO(row);
  }

  /** Throws `IpcError("MEDIA_ASSET_IN_USE")` when the asset is still referenced
   *  by a program item (`onDelete: "restrict"` in the schema) — a saved
   *  program's history must not silently lose an item.
   *
   *  SQLite reports a RESTRICT violation as `SQLITE_CONSTRAINT_TRIGGER`, not
   *  `SQLITE_CONSTRAINT_FOREIGNKEY` (that code is only for an immediate FK
   *  check, e.g. an insert with a bad reference) — RESTRICT is implemented
   *  internally as a trigger, so the message is the one stable signal. */
  remove(id: number): void {
    try {
      this.db.delete(mediaAssets).where(eq(mediaAssets.id, id)).run();
    } catch (error) {
      if (error instanceof Database.SqliteError && error.message.includes("FOREIGN KEY constraint failed")) {
        throw new IpcError({
          code: "MEDIA_ASSET_IN_USE",
          message: `Media asset ${id} is still referenced by a program item`,
        });
      }
      throw error;
    }
  }

  getById(id: number): MediaAsset | null {
    const row = this.db.select().from(mediaAssets).where(eq(mediaAssets.id, id)).get();
    return row ? toDTO(row) : null;
  }

  getPathById(id: number): string | null {
    const row = this.db.select().from(mediaAssets).where(eq(mediaAssets.id, id)).get();
    return row ? row.path : null;
  }

  linkedAudioPathById(id: number): string | null {
    const row = this.db.select().from(mediaAssets).where(eq(mediaAssets.id, id)).get();
    return row?.linkedAudioPath ?? null;
  }

  /** Manual override for when the heuristic in `linked-audio.ts` guesses
   *  wrong (or there's simply no matching file yet) — set from the "Assign
   *  audio" / "Remove" controls. `audioPath: null` means "this deck has no
   *  audio", not "go back to guessing" — either way, this is an explicit
   *  operator decision, so it also flips `linkedAudioManual` and freezes
   *  `ensureLinkedAudio` for this asset. */
  setLinkedAudio(id: number, audioPath: string | null): MediaAsset | null {
    const row = this.db.select().from(mediaAssets).where(eq(mediaAssets.id, id)).get();
    if (!row) return null;
    this.db
      .update(mediaAssets)
      .set({
        linkedAudioPath: audioPath,
        linkedAudioManual: 1,
        linkedAudioResolvedVersion: LINKED_AUDIO_RESOLVER_VERSION,
        updatedAt: Date.now(),
      })
      .where(eq(mediaAssets.id, id))
      .run();
    return toDTO({ ...row, linkedAudioPath: audioPath, linkedAudioManual: 1 });
  }

  /** Re-resolves the linked audio for a `ppt` asset, unless the operator
   *  already made an explicit call (`linkedAudioManual`) — that decision
   *  always wins over the heuristic. Called on every deck load (`peek`/
   *  `ensure` fire on every switch between decks in the UI), so the fast
   *  path matters: `resolveLinkedAudio` reads the whole folder and, for
   *  legacy binaries, the whole presentation file into memory to extract its
   *  hint — reasonable once, not on every click. A row already resolved at
   *  the current `LINKED_AUDIO_RESOLVER_VERSION` is trusted as-is (even a
   *  cached "no match") as long as its file, if any, still exists; only a
   *  stale version or a missing file pays for a full re-resolution. That
   *  version bump is what self-corrects assets linked under an older,
   *  looser version of the matching rules without a per-asset manual fix. */
  ensureLinkedAudio(id: number): void {
    const row = this.db.select().from(mediaAssets).where(eq(mediaAssets.id, id)).get();
    if (!row || row.kind !== "ppt") return;
    if (row.linkedAudioManual === 1) return;
    const upToDate = row.linkedAudioResolvedVersion === LINKED_AUDIO_RESOLVER_VERSION;
    const fileStillThere = row.linkedAudioPath === null || fs.existsSync(row.linkedAudioPath);
    if (upToDate && fileStillThere) return;

    const resolved = resolveLinkedAudio(row.path);
    if (resolved !== row.linkedAudioPath || !upToDate) {
      this.db
        .update(mediaAssets)
        .set({
          linkedAudioPath: resolved,
          linkedAudioResolvedVersion: LINKED_AUDIO_RESOLVER_VERSION,
          updatedAt: Date.now(),
        })
        .where(eq(mediaAssets.id, id))
        .run();
    }
  }

  /** Re-stats every in-library row, marking newly-missing files and clearing the flag
   *  on ones that reappeared (e.g. a reconnected drive). Never deletes rows. */
  sweep(): void {
    const rows = this.db.select().from(mediaAssets).where(eq(mediaAssets.inLibrary, 1)).all();
    const now = Date.now();
    for (const row of rows) {
      const exists = fs.existsSync(row.path);
      if (exists && row.missingSince !== null) {
        this.db
          .update(mediaAssets)
          .set({ missingSince: null, lastSeenAt: now })
          .where(eq(mediaAssets.id, row.id))
          .run();
      } else if (!exists && row.missingSince === null) {
        this.db
          .update(mediaAssets)
          .set({ missingSince: now })
          .where(eq(mediaAssets.id, row.id))
          .run();
      }
    }
  }

  relocate(id: number, newPath: string): MediaAsset | null {
    const row = this.db.select().from(mediaAssets).where(eq(mediaAssets.id, id)).get();
    if (!row) return null;
    const stat = fs.statSync(newPath);
    const now = Date.now();
    this.db
      .update(mediaAssets)
      .set({
        path: newPath,
        pathKey: toPathKey(newPath),
        sizeBytes: stat.size,
        mtimeMs: Math.trunc(stat.mtimeMs),
        missingSince: null,
        lastSeenAt: now,
        updatedAt: now,
      })
      .where(eq(mediaAssets.id, id))
      .run();
    return toDTO({ ...row, path: newPath, missingSince: null });
  }
}
