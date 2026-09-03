import { screen } from "electron";
import type { Handlers } from "../register";
import type { DisplayInfo } from "@shared/types/display";

export const displaysHandlers: Pick<Handlers, "displays:list"> = {
  "displays:list": (): DisplayInfo[] =>
    screen.getAllDisplays().map((d) => ({
      id: d.id,
      label: `${d.bounds.width}x${d.bounds.height}`,
      primary: d.id === screen.getPrimaryDisplay().id,
      bounds: d.bounds,
      scaleFactor: d.scaleFactor,
    })),
};
