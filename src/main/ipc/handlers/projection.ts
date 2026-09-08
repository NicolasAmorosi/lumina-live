import type { Handlers } from "../register";
import { projectionState } from "../../services/projection-state";
import { createProjectionWindow } from "../../windows/projection-window";
import { getHistoryRepo } from "../../services/repos";
import { broadcast } from "../../services/broadcast";

let currentServiceId: number | null = null;

export function setCurrentServiceId(id: number | null): void {
  currentServiceId = id;
}

export const projectionHandlers: Pick<
  Handlers,
  | "projection:open"
  | "projection:close"
  | "projection:show"
  | "projection:mediaCommand"
  | "projection:setSoundtrack"
  | "projection:reportMediaStatus"
  | "projection:getSnapshot"
> = {
  "projection:open": ({ displayId }) => {
    const existing = projectionState.getWindow();
    if (existing) existing.close();
    const win = createProjectionWindow(displayId);
    projectionState.setWindow(win);
    win.on("closed", () => projectionState.setWindow(null));
  },

  "projection:close": () => {
    const win = projectionState.getWindow();
    win?.close();
    projectionState.setWindow(null);
  },

  "projection:show": (output) => {
    projectionState.send(output);
    getHistoryRepo().record(output, currentServiceId);
  },

  "projection:getSnapshot": () => projectionState.getSnapshot(),

  "projection:mediaCommand": (command) => {
    const win = projectionState.getWindow();
    win?.webContents.send("media-command", command);
  },

  "projection:setSoundtrack": (soundtrack) => {
    projectionState.setSoundtrack(soundtrack);
  },

  /** The projection window describing its own media element; forwarded to the
   *  control window, which owns the autoplay clock. */
  "projection:reportMediaStatus": (status) => {
    broadcast("media-status", status);
  },
};
