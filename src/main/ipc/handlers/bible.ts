import { dialog } from "electron";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { Handlers } from "../register";
import { getBibleRepo } from "../../services/repos";
import { seedBibleFromFile } from "../../db/seed/seed-bible";
import type { Db } from "../../db/client";
import type Database from "better-sqlite3";

let dbRef: { db: Db; sqlite: Database.Database } | null = null;
export function setBibleDb(db: Db, sqlite: Database.Database): void {
  dbRef = { db, sqlite };
}

export const bibleHandlers: Pick<
  Handlers,
  "bible:versions" | "bible:books" | "bible:chapter" | "bible:search" | "bible:import"
> = {
  "bible:versions": () => getBibleRepo().listVersions(),
  "bible:books": ({ versionId }) => getBibleRepo().listBooks(versionId),
  "bible:chapter": ({ bookId, chapter }) => getBibleRepo().getChapter(bookId, chapter),
  "bible:search": ({ versionId, query, limit }) => getBibleRepo().search(versionId, query, limit),

  "bible:import": async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openFile"],
      filters: [{ name: "Biblia (JSON)", extensions: ["json"] }],
    });
    if (result.canceled || result.filePaths.length === 0 || !dbRef) return null;

    const filePath = result.filePaths[0]!;
    const name = path.basename(filePath, path.extname(filePath));
    // Unlike the legacy import-bible, this NEVER writes into the app bundle —
    // the JSON is parsed in memory and only SQL rows land on disk, in userData.
    const code = `custom-${randomUUID().slice(0, 8)}`;
    const seeded = seedBibleFromFile(dbRef.db, dbRef.sqlite, filePath, code, name, false);
    if (!seeded) return null;

    const versions = getBibleRepo().listVersions();
    return versions.find((v) => v.id === seeded.versionId) ?? null;
  },
};
