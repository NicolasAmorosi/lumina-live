import { desc, sql } from "drizzle-orm";
import type { Db } from "../client";
import { projectionHistory } from "../schema";
import type { ProjectionOutput } from "@shared/types/projection";

const MAX_ROWS = 5000;

export class HistoryRepo {
  constructor(private readonly db: Db) {}

  /** Last deck recorded, so a 60-slide auto-advancing deck writes one row
   *  instead of 60 and doesn't burn through MAX_ROWS in a few programs. */
  private lastDeckAssetId: number | null = null;

  record(output: ProjectionOutput, programId: number | null): void {
    if (output.kind === "black") return; // not worth remembering

    if (output.kind === "slide") {
      if (this.lastDeckAssetId === output.deckAssetId) return;
      this.lastDeckAssetId = output.deckAssetId;
      this.db
        .insert(projectionHistory)
        .values({
          projectedAt: Date.now(),
          kind: "slide",
          mediaAssetId: output.deckAssetId,
          programId,
          reference: null,
          // `preload` is a transient rendering detail, not history.
          snapshotJson: JSON.stringify({
            kind: "slide",
            deckAssetId: output.deckAssetId,
            total: output.total,
          }),
        })
        .run();
      return;
    }

    this.lastDeckAssetId = null;
    this.db
      .insert(projectionHistory)
      .values({
        projectedAt: Date.now(),
        kind: output.kind,
        mediaAssetId: null,
        programId,
        reference: "reference" in output ? output.reference : null,
        snapshotJson: JSON.stringify(output),
      })
      .run();
  }

  recent(limit = 50) {
    return this.db
      .select()
      .from(projectionHistory)
      .orderBy(desc(projectionHistory.projectedAt))
      .limit(limit)
      .all();
  }

  /** Called once at startup (deferred — see `main/index.ts`) to keep the table
   *  bounded.
   *
   *  Done entirely in SQL: the previous version pulled EVERY id into memory,
   *  sorted them in JS and deleted with `IN (...)`, which on a table that had
   *  been growing unbounded (this method had no caller at all) meant both a
   *  full materialization and a bound-parameter list large enough to hit
   *  SQLite's limit — the prune would throw exactly when it was most needed. */
  prune(): void {
    this.db
      .delete(projectionHistory)
      .where(
        sql`${projectionHistory.id} NOT IN (
          SELECT ${projectionHistory.id} FROM ${projectionHistory}
          ORDER BY ${projectionHistory.id} DESC LIMIT ${MAX_ROWS}
        )`,
      )
      .run();
  }
}
