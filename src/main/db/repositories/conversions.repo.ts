import type Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import type { Db } from "../client";
import { mediaConversions } from "../schema";
import type { AssetKind } from "@shared/constants";

/** One video/audio asset as the conversion service sees it: the file, and what
 *  is already known about it (null when it was never probed). */
export type ConversionCandidate = {
  id: number;
  kind: AssetKind;
  path: string;
  ext: string;
  sizeBytes: number | null;
  mtimeMs: number | null;
  conversion: {
    sourceSize: number;
    sourceMtimeMs: number;
    probeVersion: number;
    probeJson: string | null;
    outputFile: string | null;
  } | null;
};

type CandidateRow = Omit<ConversionCandidate, "conversion"> & {
  sourceSize: number | null;
  sourceMtimeMs: number;
  probeVersion: number;
  probeJson: string | null;
  outputFile: string | null;
};

export class ConversionsRepo {
  constructor(
    private readonly db: Db,
    private readonly sqlite: Database.Database,
  ) {}

  private outputStatement: Database.Statement | null = null;

  /** Every video and audio file that is still there, linked folders included
   *  (`in_library = 0` is most of a real library), with its conversion row —
   *  or just the one asset `id` names. */
  candidates(id?: number): ConversionCandidate[] {
    const rows = this.sqlite
      .prepare(
        `SELECT a.id, a.kind, a.path, a.ext, a.size_bytes AS sizeBytes, a.mtime_ms AS mtimeMs,
                c.source_size AS sourceSize, c.source_mtime_ms AS sourceMtimeMs,
                c.probe_version AS probeVersion, c.probe_json AS probeJson, c.output_file AS outputFile
           FROM media_assets a
           LEFT JOIN media_conversions c ON c.media_asset_id = a.id
          WHERE a.kind IN ('video', 'audio') AND a.missing_since IS NULL
            ${id === undefined ? "" : "AND a.id = ?"}`,
      )
      .all(...(id === undefined ? [] : [id])) as CandidateRow[];
    return rows.map(({ sourceSize, sourceMtimeMs, probeVersion, probeJson, outputFile, ...asset }) => ({
      ...asset,
      conversion: sourceSize === null ? null : { sourceSize, sourceMtimeMs, probeVersion, probeJson, outputFile },
    }));
  }

  /** Records a probe for the bytes `(size, mtime)` describe. A new stamp drops
   *  the old output: it is a copy of a file that no longer exists. */
  recordProbe(id: number, sourceSize: number, sourceMtimeMs: number, probeVersion: number, probeJson: string | null) {
    const now = Date.now();
    this.db
      .insert(mediaConversions)
      .values({ mediaAssetId: id, sourceSize, sourceMtimeMs, probeVersion, probeJson, outputFile: null, updatedAt: now })
      .onConflictDoUpdate({
        target: mediaConversions.mediaAssetId,
        set: { sourceSize, sourceMtimeMs, probeVersion, probeJson, outputFile: null, updatedAt: now },
      })
      .run();
  }

  /** Records a finished copy, but only if the row still describes the bytes it
   *  was made from. False when a re-probe re-stamped it meanwhile. */
  setOutputIfStamped(id: number, sourceSize: number, sourceMtimeMs: number, outputFile: string): boolean {
    const result = this.sqlite
      .prepare(
        `UPDATE media_conversions SET output_file = ?, updated_at = ?
          WHERE media_asset_id = ? AND source_size = ? AND source_mtime_ms = ?`,
      )
      .run(outputFile, Date.now(), id, sourceSize, sourceMtimeMs);
    return result.changes > 0;
  }

  setOutput(id: number, outputFile: string | null): void {
    this.db
      .update(mediaConversions)
      .set({ outputFile, updatedAt: Date.now() })
      .where(eq(mediaConversions.mediaAssetId, id))
      .run();
  }

  /**
   * The converted file to serve for this asset, if there is a current one.
   * Hit on every `worship://asset/<id>` request — a playing video issues many —
   * so it is one prepared, indexed statement. The stamp is compared against
   * the ASSET's size/mtime, which the library keeps current: an edited source
   * stops being served its old copy the moment the library notices the edit.
   */
  outputFor(id: number): string | null {
    this.outputStatement ??= this.sqlite.prepare(
      `SELECT c.output_file AS outputFile
         FROM media_conversions c JOIN media_assets a ON a.id = c.media_asset_id
        WHERE c.media_asset_id = ? AND c.output_file IS NOT NULL
          AND c.source_size IS a.size_bytes AND c.source_mtime_ms IS a.mtime_ms`,
    );
    const row = this.outputStatement.get(id) as { outputFile: string } | undefined;
    return row?.outputFile ?? null;
  }

  /** Every output file a row still points at — what the startup sweep keeps. */
  outputFiles(): Set<string> {
    const rows = this.sqlite
      .prepare(`SELECT output_file AS outputFile FROM media_conversions WHERE output_file IS NOT NULL`)
      .all() as { outputFile: string }[];
    return new Set(rows.map((row) => row.outputFile));
  }
}
