import { desc, inArray } from "drizzle-orm";
import type { Db } from "../client";
import { projectionHistory } from "../schema";
import type { ProjectionOutput } from "@shared/types/projection";

const MAX_ROWS = 5000;

export class HistoryRepo {
  constructor(private readonly db: Db) {}

  /** Last deck recorded, so a 60-slide auto-advancing deck writes one row
   *  instead of 60 and doesn't burn through MAX_ROWS in a few services. */
  private lastDeckAssetId: number | null = null;

  record(output: ProjectionOutput, serviceId: number | null): void {
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
          serviceId,
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
        serviceId,
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

  /** Called once at startup to keep the table bounded. */
  prune(): void {
    const rows = this.db.select({ id: projectionHistory.id }).from(projectionHistory).all();
    if (rows.length <= MAX_ROWS) return;
    // Oldest-first ids beyond the cap; projectionHistory.id is monotonically increasing.
    const toDelete = rows
      .map((r) => r.id)
      .sort((a, b) => a - b)
      .slice(0, rows.length - MAX_ROWS);
    if (toDelete.length === 0) return;
    this.db.delete(projectionHistory).where(inArray(projectionHistory.id, toDelete)).run();
  }
}
