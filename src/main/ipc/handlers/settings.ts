import type { Handlers } from "../register";
import { getSettingsRepo } from "../../services/repos";

export const settingsHandlers: Pick<Handlers, "settings:get" | "settings:set"> = {
  "settings:get": () => getSettingsRepo().getAll(),
  "settings:set": (partial) => {
    getSettingsRepo().setMany(partial);
  },
};
