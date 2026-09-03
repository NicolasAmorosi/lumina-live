import type { Handlers } from "../register";
import { projectionState } from "../../services/projection-state";
import { createProjectionWindow } from "../../windows/projection-window";
import { getHistoryRepo } from "../../services/repos";

let currentServiceId: number | null = null;

export function setCurrentServiceId(id: number | null): void {
  currentServiceId = id;
}

export const projectionHandlers: Pick<
  Handlers,
  | "projection:open"
  | "projection:close"
  | "projection:show"
  | "projection:setOverlayVisible"
  | "projection:videoCommand"
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

  "projection:setOverlayVisible": ({ visible }) => {
    const win = projectionState.getWindow();
    if (!win) return;
    if (visible) {
      win.show();
      win.setAlwaysOnTop(true, "screen-saver");
    } else {
      win.hide();
    }
  },

  "projection:videoCommand": (command) => {
    const win = projectionState.getWindow();
    win?.webContents.send("video-command", command);
  },
};
