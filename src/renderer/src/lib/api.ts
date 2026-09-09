import { invoke } from "./ipc";
import type { AssetKind } from "@shared/constants";
import type {
  AudioTrackPush,
  MediaCommand,
  ProjectionOutput,
} from "@shared/types/projection";
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
    mediaCommand: (command: MediaCommand) => invoke("projection:mediaCommand", command),
    setAudioTracks: (tracks: AudioTrackPush[]) => invoke("projection:setAudioTracks", tracks),
    getSnapshot: () => invoke("projection:getSnapshot", undefined),
  },
  files: {
    pick: (kind: AssetKind | "all", multiple: boolean) => invoke("files:pick", { kind, multiple }),
    probe: (path: string) => invoke("files:probe", { path }),
    setLogo: () => invoke("files:setLogo", undefined),
    pickFolder: () => invoke("files:pickFolder", undefined),
  },
  deck: {
    get: (assetId: number) => invoke("deck:get", { assetId }),
    ensure: (assetId: number, force?: boolean) =>
      invoke("deck:ensure", { assetId, ...(force !== undefined ? { force } : {}) }),
    cancel: (assetId: number) => invoke("deck:cancel", { assetId }),
    progress: (assetId: number) => invoke("deck:progress", { assetId }),
    environment: () => invoke("deck:environment", undefined),
    locateSoffice: () => invoke("deck:locateSoffice", undefined),
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
    remove: (id: number, force?: boolean) =>
      invoke("library:remove", { id, ...(force !== undefined ? { force } : {}) }),
    usages: (id: number) => invoke("library:usages", { id }),
    relocate: (id: number) => invoke("library:relocate", { id }),
    setLinkedAudio: (id: number, path: string | null) =>
      invoke("library:setLinkedAudio", { id, path }),
    listFolder: (kind: AssetKind, path: string) => invoke("library:listFolder", { kind, path }),
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
