import fs from "node:fs";
import path from "node:path";
import { eq, and } from "drizzle-orm";
import type { Db } from "../client";
import { mediaAssets } from "../schema";
import type { AssetKind } from "@shared/constants";
import type { MediaAsset } from "@shared/types/media";

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

/** Finds a sibling `.mp3` with the same basename — the "linked audio" convention. */
export function findLinkedAudio(filePath: string): string | null {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath, path.extname(filePath));
  const candidate = path.join(dir, `${base}.mp3`);
  return fs.existsSync(candidate) ? candidate : null;
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
   *  referenced by a service but not shown in the library list). */
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

  remove(id: number): void {
    this.db.delete(mediaAssets).where(eq(mediaAssets.id, id)).run();
  }

  getById(id: number): MediaAsset | null {
    const row = this.db.select().from(mediaAssets).where(eq(mediaAssets.id, id)).get();
    return row ? toDTO(row) : null;
  }

  getPathById(id: number): string | null {
    const row = this.db.select().from(mediaAssets).where(eq(mediaAssets.id, id)).get();
    return row ? row.path : null;
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
