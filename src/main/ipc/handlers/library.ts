import type { Handlers } from "../register";
import { getMediaRepo } from "../../services/repos";

export const libraryHandlers: Pick<
  Handlers,
  "library:list" | "library:get" | "library:add" | "library:remove" | "library:relocate"
> = {
  "library:list": ({ kind }) => {
    getMediaRepo().sweep();
    return getMediaRepo().list(kind);
  },

  "library:get": ({ id }) => getMediaRepo().getById(id),

  "library:add": ({ paths, kind }) =>
    paths.map((p) => getMediaRepo().upsertFromPath(p, kind, true)),

  "library:remove": ({ id }) => {
    getMediaRepo().remove(id);
  },

  "library:relocate": async ({ id }) => {
    const { dialog } = await import("electron");
    const result = await dialog.showOpenDialog({ properties: ["openFile"] });
    if (result.canceled || result.filePaths.length === 0) return null;
    return getMediaRepo().relocate(id, result.filePaths[0]!);
  },
};
