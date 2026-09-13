import { dialog } from "electron";
import path from "node:path";
import type { Handlers } from "../register";
import { ASSET_EXTENSIONS, ASSET_KINDS, type AssetKind } from "@shared/constants";
import { getSettingsRepo } from "../../services/repos";

function filtersFor(kind: AssetKind | "all") {
  if (kind === "all") {
    return [{ name: "all", extensions: ASSET_KINDS.flatMap((k) => [...ASSET_EXTENSIONS[k]]) }];
  }
  return [{ name: kind, extensions: [...ASSET_EXTENSIONS[kind]] }];
}

export const filesHandlers: Pick<
  Handlers,
  "files:pick" | "files:setLogo" | "files:pickFolder"
> = {
  "files:pick": async ({ kind, multiple }) => {
    const settingsRepo = getSettingsRepo();
    const lastFolder = settingsRepo.get("files.lastFolder");
    const result = await dialog.showOpenDialog({
      properties: multiple ? ["openFile", "multiSelections"] : ["openFile"],
      filters: filtersFor(kind),
      ...(lastFolder ? { defaultPath: lastFolder } : {}),
    });
    if (result.canceled || result.filePaths.length === 0) return [];
    settingsRepo.setMany({ "files.lastFolder": path.dirname(result.filePaths[0]!) });
    return result.filePaths;
  },

  "files:pickFolder": async () => {
    const result = await dialog.showOpenDialog({ properties: ["openDirectory"] });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0]!;
  },

  "files:setLogo": async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openFile"],
      filters: [{ name: "Imagen", extensions: [...ASSET_EXTENSIONS.image] }],
    });
    if (result.canceled || result.filePaths.length === 0) return getSettingsRepo().get("logo.path");
    const chosen = result.filePaths[0]!;
    getSettingsRepo().setMany({ "logo.path": chosen });
    return chosen;
  },
};
