import { invoke } from "./ipc";
import type { AssetKind } from "@shared/constants";
import type {
  AudioTrackPush,
  MediaCommand,
  ProjectionMediaError,
  ProjectionOutput,
} from "@shared/types/projection";
import type {
  ProgramDraft,
  ProgramDuplicateInput,
  ProgramMetaUpsert,
  ProgramUpsert,
} from "@shared/types/program";
import type { SettingsMap } from "@shared/types/settings";
import type { UtilitySceneUpsert } from "@shared/types/utility";
import type { CloseDecision } from "@shared/types/window";

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
    reportMediaError: (error: ProjectionMediaError) => invoke("projection:reportMediaError", error),
  },
  files: {
    pick: (kind: AssetKind | "all", multiple: boolean) => invoke("files:pick", { kind, multiple }),
    setLogo: () => invoke("files:setLogo", undefined),
    pickFolder: (defaultPath?: string) => invoke("files:pickFolder", { defaultPath }),
    systemFolders: () => invoke("files:systemFolders", undefined),
  },
  deck: {
    get: (assetId: number) => invoke("deck:get", { assetId }),
    ensure: (assetId: number, force?: boolean) =>
      invoke("deck:ensure", { assetId, ...(force !== undefined ? { force } : {}) }),
    cancel: (assetId: number) => invoke("deck:cancel", { assetId }),
    environment: () => invoke("deck:environment", undefined),
    locateSoffice: () => invoke("deck:locateSoffice", undefined),
    prewarm: (assetIds: number[], scope: "program" | "explicit" | "visible") =>
      invoke("deck:prewarm", { assetIds, scope }),
    prewarmBatch: (assetIds: number[], label: string) => invoke("deck:prewarmBatch", { assetIds, label }),
    cancelPrewarmBatch: (jobId: string) => invoke("deck:cancelPrewarmBatch", { jobId }),
    statuses: (assetIds: number[]) => invoke("deck:statuses", { assetIds }),
    cacheStats: () => invoke("deck:cacheStats", undefined),
    clearCache: () => invoke("deck:clearCache", undefined),
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
  programs: {
    list: () => invoke("programs:list", undefined),
    load: (id: number) => invoke("programs:load", { id }),
    /** Read-only: use this anywhere the operator is looking at a program
     *  rather than opening one. `load` adopts it in main. */
    peek: (id: number) => invoke("programs:peek", { id }),
    save: (input: ProgramUpsert) => invoke("programs:save", input),
    delete: (id: number) => invoke("programs:delete", { id }),
    releaseCurrent: () => invoke("programs:releaseCurrent", undefined),
    updateMeta: (input: ProgramMetaUpsert) => invoke("programs:updateMeta", input),
    duplicate: (input: ProgramDuplicateInput) => invoke("programs:duplicate", input),
    setFavorite: (input: { id: number; favorite: boolean }) => invoke("programs:setFavorite", input),
    reorder: (ids: number[]) => invoke("programs:reorder", { ids }),
  },
  /** The unsaved schedule, mirrored to disk — see `effects/draft-autosave.ts`. */
  draft: {
    save: (draft: ProgramDraft | null) => invoke("program:saveDraft", draft),
    load: () => invoke("program:loadDraft", undefined),
  },
  window: {
    /** Answers main's `close-requested` — see `CloseDecision`. */
    closeDecision: (decision: CloseDecision) => invoke("window:closeDecision", { decision }),
  },
  /** Saved time scenes — the countdowns, the clock and the stopwatch of
   *  Funciones ▸ Utilidades. `remove` rather than `delete` for the same reason
   *  `library` uses it: a reserved word reads badly as a method. */
  utility: {
    list: () => invoke("utility:list", undefined),
    create: (input: UtilitySceneUpsert) => invoke("utility:create", input),
    update: (input: UtilitySceneUpsert & { id: number }) => invoke("utility:update", input),
    duplicate: (id: number, name: string) => invoke("utility:duplicate", { id, name }),
    remove: (id: number, force = false) => invoke("utility:delete", { id, force }),
    usages: (id: number) => invoke("utility:usages", { id }),
    reorder: (ids: number[]) => invoke("utility:reorder", { ids }),
  },
  settings: {
    get: () => invoke("settings:get", undefined),
    set: (partial: Partial<SettingsMap>) => invoke("settings:set", partial),
  },
};
