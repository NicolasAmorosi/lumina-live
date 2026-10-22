import fs from "node:fs";
import path from "node:path";
import { shell } from "electron";
import type { Handlers } from "../register";
import type { DeckEnvironment } from "@shared/types/deck";
import { getSettingsRepo } from "../../services/repos";
import {
  cacheStats,
  cancel,
  clearCache,
  getDeck,
  prepareDeck,
  prewarmExplicit,
  setVisiblePrewarm,
} from "../../slides/deck-service";
import { cancelPrewarmBatch, deckStatuses, startPrewarmBatch } from "../../services/prewarm-service";
import { invalidateSofficeCache, locateSoffice, type SofficeStatus } from "../../slides/libreoffice";
import { showOpenDialogFor } from "../open-dialog";
import { mt } from "../../i18n";

/** The page that picks the right installer for the visitor's OS by itself. */
const SOFFICE_DOWNLOAD_URL = "https://www.libreoffice.org/download/download-libreoffice/";

function toEnvironment(status: SofficeStatus): DeckEnvironment {
  return status.available
    ? { available: true, sofficePath: status.info.path, version: status.info.version, message: null }
    : { available: false, sofficePath: null, version: null, message: status.message };
}

export const slidesHandlers: Pick<
  Handlers,
  | "deck:get"
  | "deck:ensure"
  | "deck:cancel"
  | "deck:environment"
  | "deck:locateSoffice"
  | "deck:openSofficeDownload"
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

  "deck:environment": async ({ force }) => toEnvironment(await locateSoffice({ force })),

  "deck:openSofficeDownload": () => shell.openExternal(SOFFICE_DOWNLOAD_URL),

  "deck:locateSoffice": async (_req, ev) => {
    const result = await showOpenDialogFor(ev.sender, {
      title: mt("dialogs.chooseSoffice"),
      properties: ["openFile"],
      ...(process.platform === "darwin" ? { defaultPath: "/Applications" } : {}),
    });

    const chosen = result.canceled ? null : (result.filePaths[0] ?? null);
    if (chosen) {
      // macOS users will naturally pick the .app bundle; resolve it to the
      // real binary instead of failing with "not executable". On Windows,
      // Explorer hides extensions, so `soffice.exe` and `soffice.com` both
      // read "soffice" — and the `.exe` returns before the PDF exists (see
      // `candidatePaths` in `libreoffice.ts`), which would fail every deck.
      const comSibling = chosen.replace(/\.exe$/i, ".com");
      const resolved = chosen.endsWith(".app")
        ? path.join(chosen, "Contents/MacOS/soffice")
        : process.platform === "win32" && comSibling !== chosen && fs.existsSync(comSibling)
          ? comSibling
          : chosen;
      getSettingsRepo().setMany({ "slides.sofficePath": resolved });
      invalidateSofficeCache();
    }

    return toEnvironment(await locateSoffice({ force: true }));
  },
};
