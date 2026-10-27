import type { Handlers } from "../register";
import { IpcError } from "@shared/ipc/result";
import {
  checkForUpdates,
  downloadUpdate,
  getUpdateStatus,
  installUpdate,
  openReleaseNotes,
} from "../../updates/updater";

export const updatesHandlers: Pick<
  Handlers,
  "updates:getStatus" | "updates:check" | "updates:download" | "updates:install" | "updates:openReleaseNotes"
> = {
  "updates:getStatus": () => getUpdateStatus(),
  "updates:check": () => checkForUpdates(true),
  "updates:download": () => downloadUpdate(),
  "updates:install": (req) => {
    if (req?.when !== "now" && req?.when !== "onQuit") {
      throw new IpcError({ code: "INVALID_ARGUMENT", message: "Invalid install time." });
    }
    installUpdate(req.when);
  },
  "updates:openReleaseNotes": () => openReleaseNotes(),
};
