import { eq, count } from "drizzle-orm";
import type Database from "better-sqlite3";
import type { Db } from "../client";
import { serviceItems, services } from "../schema";
import type {
  ServiceDTO,
  ServiceItemDTO,
  ServiceItemUpsert,
  ServiceSummary,
  ServiceUpsert,
} from "@shared/types/service";
import type { MediaAssetUsage } from "@shared/types/media";

function toItemDTO(row: typeof serviceItems.$inferSelect): ServiceItemDTO {
  const base = { id: row.id, position: row.position, title: row.title };
  switch (row.kind) {
    case "media":
      return { ...base, kind: "media", mediaAssetId: row.mediaAssetId! };
    case "ppt":
      return { ...base, kind: "ppt", mediaAssetId: row.mediaAssetId! };
    case "text":
      return { ...base, kind: "text", body: row.textBody ?? "" };
    case "bible":
    default:
      return {
        id: row.id,
        position: row.position,
        kind: "bible",
        bibleVersionId: row.bibleVersionId,
        bibleBookId: row.bibleBookId,
        chapter: row.bibleChapter,
        verseFrom: row.bibleVerseFrom,
        verseTo: row.bibleVerseTo,
        reference: row.bibleReference ?? "",
        text: row.bibleText ?? "",
      };
  }
}

export class ServicesRepo {
  constructor(
    private readonly db: Db,
    private readonly sqlite: Database.Database,
  ) {}

  list(): ServiceSummary[] {
    const rows = this.db.select().from(services).all();
    return rows.map((s) => ({
      id: s.id,
      name: s.name,
      notes: s.notes,
      serviceDate: s.serviceDate,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      lastOpenedAt: s.lastOpenedAt,
      itemCount:
        this.db.select({ n: count() }).from(serviceItems).where(eq(serviceItems.serviceId, s.id)).get()
          ?.n ?? 0,
    }));
  }

  load(id: number): ServiceDTO {
    const s = this.db.select().from(services).where(eq(services.id, id)).get();
    if (!s) throw new Error(`Service ${id} not found`);
    this.db
      .update(services)
      .set({ lastOpenedAt: Date.now() })
      .where(eq(services.id, id))
      .run();
    const items = this.db
      .select()
      .from(serviceItems)
      .where(eq(serviceItems.serviceId, id))
      .orderBy(serviceItems.position)
      .all()
      .map(toItemDTO);
    return {
      id: s.id,
      name: s.name,
      notes: s.notes,
      serviceDate: s.serviceDate,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      lastOpenedAt: Date.now(),
      itemCount: items.length,
      items,
    };
  }

  /** Replaces a service's items wholesale inside one transaction — reordering,
   *  adding and removing items is all "save the whole playlist again", matching
   *  how the control window's playlist editor actually works. */
  save(input: ServiceUpsert): ServiceSummary {
    const now = Date.now();
    const run = this.sqlite.transaction(() => {
      let serviceId = input.id;
      if (serviceId) {
        this.db
          .update(services)
          .set({
            name: input.name,
            notes: input.notes ?? null,
            serviceDate: input.serviceDate ?? null,
            updatedAt: now,
          })
          .where(eq(services.id, serviceId))
          .run();
        this.db.delete(serviceItems).where(eq(serviceItems.serviceId, serviceId)).run();
      } else {
        serviceId = this.db
          .insert(services)
          .values({
            name: input.name,
            notes: input.notes ?? null,
            serviceDate: input.serviceDate ?? null,
            createdAt: now,
            updatedAt: now,
          })
          .run().lastInsertRowid as number;
      }

      input.items.forEach((item: ServiceItemUpsert, index: number) => {
        this.db.insert(serviceItems).values(toRow(serviceId!, index, item, now)).run();
      });

      return serviceId;
    });

    const id = run();
    const s = this.db.select().from(services).where(eq(services.id, id)).get()!;
    return {
      id: s.id,
      name: s.name,
      notes: s.notes,
      serviceDate: s.serviceDate,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      lastOpenedAt: s.lastOpenedAt,
      itemCount: input.items.length,
    };
  }

  delete(id: number): void {
    this.db.delete(services).where(eq(services.id, id)).run();
  }

  /** Which saved services still reference `assetId`, for the "delete anyway"
   *  confirmation — the FK violation itself doesn't say which service. */
  findUsages(assetId: number): MediaAssetUsage[] {
    const rows = this.db
      .select({
        serviceId: services.id,
        serviceName: services.name,
        serviceDate: services.serviceDate,
        itemCount: count(),
      })
      .from(serviceItems)
      .innerJoin(services, eq(serviceItems.serviceId, services.id))
      .where(eq(serviceItems.mediaAssetId, assetId))
      .groupBy(services.id)
      .all();
    return rows;
  }

  /** Removes every item pointing at `assetId` across all services — the only
   *  way to free the `onDelete: "restrict"` FK on `service_items.media_asset_id`,
   *  since the table's CHECK constraint forbids a `media`/`ppt` item with a
   *  null asset. Leaves gaps in `position`, which `load()`'s ORDER BY and the
   *  next `save()`'s reindex both tolerate. */
  deleteItemsByMediaAsset(assetId: number): void {
    this.db.delete(serviceItems).where(eq(serviceItems.mediaAssetId, assetId)).run();
  }
}

function toRow(serviceId: number, position: number, item: ServiceItemUpsert, now: number) {
  const common = { serviceId, position, createdAt: now, title: null as string | null };
  switch (item.kind) {
    case "media":
    case "ppt":
      return { ...common, kind: item.kind, mediaAssetId: item.mediaAssetId, title: item.title };
    case "text":
      return { ...common, kind: "text" as const, textBody: item.body, title: item.title };
    case "bible":
    default:
      return {
        ...common,
        kind: "bible" as const,
        bibleVersionId: item.bibleVersionId,
        bibleBookId: item.bibleBookId,
        bibleChapter: item.chapter,
        bibleVerseFrom: item.verseFrom,
        bibleVerseTo: item.verseTo,
        bibleReference: item.reference,
        bibleText: item.text,
      };
  }
}
