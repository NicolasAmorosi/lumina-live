import { dialog } from "electron";
import path from "node:path";
import type { Handlers } from "../register";
import type { DeckEnvironment } from "@shared/types/deck";
import { getSettingsRepo } from "../../services/repos";
import {
  cacheStats,
  cancel,
  clearCache,
  getDeck,
  prepareDeck,
  currentProgress,
  prewarmExplicit,
  setVisiblePrewarm,
} from "../../slides/deck-service";
import { cancelPrewarmBatch, deckStatuses, startPrewarmBatch } from "../../services/prewarm-service";
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
  | "deck:prewarm"
  | "deck:prewarmBatch"
  | "deck:cancelPrewarmBatch"
  | "deck:statuses"
  | "deck:cacheStats"
  | "deck:clearCache"
> = {
  "deck:get": ({ assetId }) => getDeck(assetId),

  "deck:ensure": ({ assetId, force }) =>
    prepareDeck(assetId, { force: force ?? false, priority: "interactive" }),

  "deck:cancel": ({ assetId }) => {
    cancel(assetId);
  },

  "deck:progress": ({ assetId }) => currentProgress(assetId),

  "deck:prewarm": ({ assetIds, scope }) => {
    if (scope === "visible") setVisiblePrewarm(assetIds);
    else prewarmExplicit(assetIds, scope);
  },

  "deck:prewarmBatch": ({ assetIds, label }) => startPrewarmBatch(assetIds, label),

  "deck:cancelPrewarmBatch": ({ jobId }) => {
    cancelPrewarmBatch(jobId);
  },

  "deck:statuses": ({ assetIds }) => deckStatuses(assetIds),

  "deck:cacheStats": () => cacheStats(),
  "deck:clearCache": () => clearCache(),

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
