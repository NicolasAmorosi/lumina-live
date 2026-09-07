import { dialog } from "electron";
import path from "node:path";
import type { Handlers } from "../register";
import type { DeckEnvironment } from "@shared/types/deck";
import { getSettingsRepo } from "../../services/repos";
import { cancel, getDeck, prepareDeck, currentProgress } from "../../slides/deck-service";
import { invalidateSofficeCache, locateSoffice, type SofficeStatus } from "../../slides/libreoffice";

function toEnvironment(status: SofficeStatus): DeckEnvironment {
  return status.available
    ? { available: true, sofficePath: status.info.path, version: status.info.version }
    : { available: false, sofficePath: null, version: null };
}

export const slidesHandlers: Pick<
  Handlers,
  | "deck:get"
  | "deck:ensure"
  | "deck:cancel"
  | "deck:progress"
  | "deck:environment"
  | "deck:locateSoffice"
> = {
  "deck:get": ({ assetId }) => getDeck(assetId),

  "deck:ensure": ({ assetId, force }) => prepareDeck(assetId, force ?? false),

  "deck:cancel": ({ assetId }) => {
    cancel(assetId);
  },

  "deck:progress": ({ assetId }) => currentProgress(assetId),

  "deck:environment": async () => toEnvironment(await locateSoffice()),

  "deck:locateSoffice": async () => {
    const result = await dialog.showOpenDialog({
      title: "Seleccioná el ejecutable de LibreOffice (soffice)",
      properties: ["openFile"],
      ...(process.platform === "darwin" ? { defaultPath: "/Applications" } : {}),
    });

    const chosen = result.canceled ? null : (result.filePaths[0] ?? null);
    if (chosen) {
      // macOS users will naturally pick the .app bundle; resolve it to the
      // real binary instead of failing with "not executable".
      const resolved = chosen.endsWith(".app")
        ? path.join(chosen, "Contents/MacOS/soffice")
        : chosen;
      getSettingsRepo().setMany({ "slides.sofficePath": resolved });
      invalidateSofficeCache();
    }

    return toEnvironment(await locateSoffice({ force: true }));
  },
};
