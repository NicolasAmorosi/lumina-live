import { eq, inArray } from "drizzle-orm";
import type { Db } from "../client";
import { mediaAssets, programDraft } from "../schema";
import type { ProgramDraft, ProgramItemUpsert } from "@shared/types/program";

/** One row, always. The table exists to answer exactly one question at launch:
 *  "was the operator in the middle of something?". */
const ROW_ID = 1;

/**
 * The unsaved order of service, mirrored out of the control window so a
 * reload, a window close, a renderer crash or a power cut cannot throw it
 * away. See `schema.ts`'s note on `program_draft` for why the items are a JSON
 * blob and not rows in `program_items`.
 */
export class DraftRepo {
  constructor(private readonly db: Db) {}

  save(draft: ProgramDraft): void {
    const values = {
      id: ROW_ID,
      programId: draft.programId,
      name: draft.name,
      notes: draft.notes,
      items: JSON.stringify(draft.items),
      updatedAt: draft.updatedAt,
    };
    this.db
      .insert(programDraft)
      .values(values)
      .onConflictDoUpdate({ target: programDraft.id, set: values })
      .run();
  }

  clear(): void {
    this.db.delete(programDraft).where(eq(programDraft.id, ROW_ID)).run();
  }

  /**
   * The draft as it can still be honoured today, or `null` when there is none.
   *
   * Items whose media asset no longer exists are dropped here rather than in
   * the renderer: main is the only side that can answer "does this asset row
   * still exist" without one IPC round trip per item, and a schedule row whose
   * asset is gone would otherwise come back as a tile that can never preview,
   * never go live and never explain itself.
   *
   * A draft whose items ALL disappeared still comes back (with an empty list)
   * when it names a saved program, because its name and `programId` are
   * themselves state worth restoring; a nameless, itemless draft is nothing
   * and returns `null`.
   */
  load(): ProgramDraft | null {
    const row = this.db.select().from(programDraft).where(eq(programDraft.id, ROW_ID)).get();
    if (!row) return null;

    let parsed: ProgramItemUpsert[];
    try {
      const value: unknown = JSON.parse(row.items);
      // A hand-edited or truncated blob must not take the launch down with it:
      // the draft is a convenience, never a dependency.
      parsed = Array.isArray(value) ? (value as ProgramItemUpsert[]) : [];
    } catch {
      parsed = [];
    }

    const items = parsed.length > 0 ? this.withLiveAssetsOnly(parsed) : parsed;
    if (items.length === 0 && row.programId === null && row.name === "") return null;

    return {
      programId: row.programId,
      name: row.name,
      notes: row.notes,
      items,
      updatedAt: row.updatedAt,
    };
  }

  private withLiveAssetsOnly(items: ProgramItemUpsert[]): ProgramItemUpsert[] {
    const referenced = [
      ...new Set(
        items.flatMap((item) => (item.kind === "media" || item.kind === "ppt" ? [item.mediaAssetId] : [])),
      ),
    ];
    if (referenced.length === 0) return items;

    const alive = new Set(
      this.db
        .select({ id: mediaAssets.id })
        .from(mediaAssets)
        .where(inArray(mediaAssets.id, referenced))
        .all()
        .map((r) => r.id),
    );
    return items.filter(
      (item) => !(item.kind === "media" || item.kind === "ppt") || alive.has(item.mediaAssetId),
    );
  }
}
