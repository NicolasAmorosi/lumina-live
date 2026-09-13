import path from "node:path";
import fs from "node:fs";
import { ASSET_EXTENSIONS } from "@shared/constants";
import { IpcError } from "@shared/ipc/result";
import type { Handlers } from "../register";
import { getMediaRepo, getProgramsRepo } from "../../services/repos";
import { removeMediaAsset } from "../../services/media-asset-removal";
import { importPaths } from "../../services/library-import";

export const libraryHandlers: Pick<
  Handlers,
  | "library:list"
  | "library:get"
  | "library:add"
  | "library:remove"
  | "library:usages"
  | "library:relocate"
  | "library:setLinkedAudio"
  | "library:listFolder"
> = {
  // A pure read: the "is this file still there?" sweep no longer runs inline
  // on every list — see `services/library-sweeper.ts`. `missingSince` can lag
  // a sweep's debounce/throttle window, which is fine: dragging a truly gone
  // file to EN VIVO is still caught downstream (`SOURCE_MISSING` in
  // `deck-service.ts`, the 410 from `worship-protocol.ts`).
  "library:list": ({ kind }) => getMediaRepo().list(kind),

  "library:get": ({ id }) => getMediaRepo().getById(id),

  "library:add": ({ paths, kind }) => importPaths(paths, kind, { inLibrary: true }),

  "library:remove": ({ id, force }) => {
    removeMediaAsset(id, force ?? false);
  },

  "library:usages": ({ id }) => getProgramsRepo().findUsages(id),

  "library:relocate": async ({ id }) => {
    const { dialog } = await import("electron");
    const result = await dialog.showOpenDialog({ properties: ["openFile"] });
    if (result.canceled || result.filePaths.length === 0) return null;
    return getMediaRepo().relocate(id, result.filePaths[0]!);
  },

  "library:setLinkedAudio": ({ id, path: audioPath }) => {
    if (audioPath !== null) {
      if (!fs.existsSync(audioPath)) {
        throw new IpcError({ code: "SOURCE_MISSING", message: "El archivo de audio no existe." });
      }
      const ext = path.extname(audioPath).replace(/^\./, "").toLowerCase();
      if (!ASSET_EXTENSIONS.audio.includes(ext)) {
        throw new IpcError({
          code: "INVALID_AUDIO_FILE",
          message: "El archivo elegido no es un audio soportado.",
        });
      }
    }
    return getMediaRepo().setLinkedAudio(id, audioPath);
  },

  "library:listFolder": async ({ kind, path: folderPath }) => {
    let entries: fs.Dirent[];
    try {
      // Asynchronous on purpose: a linked folder is routinely a USB stick or
      // an SMB share, where a directory listing can take seconds. Done
      // synchronously it froze the main process — which means it froze the
      // PROJECTION — for as long as the drive took to answer.
      entries = await fs.promises.readdir(folderPath, { withFileTypes: true });
    } catch {
      return [];
    }
    const extensions = new Set<string>(ASSET_EXTENSIONS[kind]);
    const matched = entries
      .filter((entry) => entry.isFile() && extensions.has(path.extname(entry.name).slice(1).toLowerCase()))
      .map((entry) => path.join(folderPath, entry.name));
    // Read-only from the caller's point of view: it returns the fresh list
    // directly, so it must never broadcast `library-changed` — see the
    // block comment on `importPaths` for why that would loop.
    return importPaths(matched, kind, { inLibrary: false, emitChanged: false });
  },
};
