import path from "node:path";
import fs from "node:fs";
import { ASSET_EXTENSIONS } from "@shared/constants";
import { IpcError } from "@shared/ipc/result";
import type { Handlers } from "../register";
import { getMediaRepo, getProgramsRepo } from "../../services/repos";
import { removeMediaAsset } from "../../services/media-asset-removal";

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
  "library:list": ({ kind }) => {
    getMediaRepo().sweep();
    return getMediaRepo().list(kind);
  },

  "library:get": ({ id }) => getMediaRepo().getById(id),

  "library:add": ({ paths, kind }) =>
    paths.map((p) => getMediaRepo().upsertFromPath(p, kind, true)),

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

  "library:listFolder": ({ kind, path: folderPath }) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(folderPath, { withFileTypes: true });
    } catch {
      return [];
    }
    const extensions = new Set<string>(ASSET_EXTENSIONS[kind]);
    return entries
      .filter((entry) => entry.isFile() && extensions.has(path.extname(entry.name).slice(1).toLowerCase()))
      .map((entry) => getMediaRepo().upsertFromPath(path.join(folderPath, entry.name), kind, false));
  },
};
