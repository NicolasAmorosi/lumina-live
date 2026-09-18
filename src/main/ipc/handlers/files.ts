import { dialog, nativeImage } from "electron";
import path from "node:path";
import type { Handlers } from "../register";
import { ASSET_EXTENSIONS, ASSET_KINDS, type AssetKind } from "@shared/constants";
import { IpcError } from "@shared/ipc/result";
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

    // A logo that cannot be decoded is persisted-then-invisible: LOGO becomes a
    // black projector with no explanation, and the operator only finds out
    // mid-service. `nativeImage` decodes here, in main, with no window
    // involved — an unreadable or non-image file comes back empty — so the
    // previous logo survives a bad pick.
    if (nativeImage.createFromPath(chosen).isEmpty()) {
      throw new IpcError({ code: "LOGO_UNREADABLE", message: `Cannot decode image: ${chosen}` });
    }

    getSettingsRepo().setMany({ "logo.path": chosen });
    return chosen;
  },
};
