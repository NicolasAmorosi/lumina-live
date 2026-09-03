import { invoke } from "./ipc";
import type { AssetKind } from "@shared/constants";
import type { ProjectionOutput, VideoCommand } from "@shared/types/projection";
import type { ServiceUpsert } from "@shared/types/service";
import type { SettingsMap } from "@shared/types/settings";

/** Thin per-domain facade over `invoke` — pure readability sugar in the
 *  renderer, not a second definition of the contract: every method's types
 *  are inferred straight from `IpcContract`. */
export const api = {
  displays: {
    list: () => invoke("displays:list", undefined),
  },
  projection: {
    open: (displayId: number) => invoke("projection:open", { displayId }),
    close: () => invoke("projection:close", undefined),
    show: (output: ProjectionOutput) => invoke("projection:show", output),
    setOverlayVisible: (visible: boolean) => invoke("projection:setOverlayVisible", { visible }),
    videoCommand: (command: VideoCommand) => invoke("projection:videoCommand", command),
  },
  files: {
    pick: (kind: AssetKind, multiple: boolean) => invoke("files:pick", { kind, multiple }),
    probe: (path: string) => invoke("files:probe", { path }),
    setLogo: () => invoke("files:setLogo", undefined),
  },
  ppt: {
    open: (assetId: number) => invoke("ppt:open", { assetId }),
    next: () => invoke("ppt:next", undefined),
    prev: () => invoke("ppt:prev", undefined),
    goto: (slide: number) => invoke("ppt:goto", { slide }),
    currentSlide: () => invoke("ppt:currentSlide", undefined),
    close: () => invoke("ppt:close", undefined),
    exportSlides: (assetId: number) => invoke("ppt:exportSlides", { assetId }),
  },
  bible: {
    versions: () => invoke("bible:versions", undefined),
    books: (versionId: number) => invoke("bible:books", { versionId }),
    chapter: (bookId: number, chapter: number) => invoke("bible:chapter", { bookId, chapter }),
    search: (versionId: number, query: string, limit?: number) =>
      invoke("bible:search", { versionId, query, ...(limit !== undefined ? { limit } : {}) }),
    import: () => invoke("bible:import", undefined),
  },
  library: {
    list: (kind: AssetKind) => invoke("library:list", { kind }),
    get: (id: number) => invoke("library:get", { id }),
    add: (paths: string[], kind: AssetKind) => invoke("library:add", { paths, kind }),
    remove: (id: number) => invoke("library:remove", { id }),
    relocate: (id: number) => invoke("library:relocate", { id }),
  },
  services: {
    list: () => invoke("services:list", undefined),
    load: (id: number) => invoke("services:load", { id }),
    save: (input: ServiceUpsert) => invoke("services:save", input),
    delete: (id: number) => invoke("services:delete", { id }),
  },
  settings: {
    get: () => invoke("settings:get", undefined),
    set: (partial: Partial<SettingsMap>) => invoke("settings:set", partial),
  },
};
