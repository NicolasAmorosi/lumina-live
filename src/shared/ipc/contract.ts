import type { AssetKind } from "../constants";
import type { DisplayInfo } from "../types/display";
import type { ImportProgress, MediaAsset, MediaAssetUsage } from "../types/media";
import type {
  BibleBookDTO,
  BibleSearchHit,
  BibleVerseDTO,
  BibleVersionDTO,
} from "../types/bible";
import type {
  AudioTrackPush,
  MediaCommand,
  MediaStatus,
  ProjectionMediaError,
  ProjectionOutput,
} from "../types/projection";
import type {
  DeckCacheStats,
  DeckDTO,
  DeckEnvironment,
  DeckProgress,
  DeckStatusSummary,
  PrewarmProgress,
} from "../types/deck";
import type {
  ProgramDTO,
  ProgramDraft,
  ProgramDuplicateInput,
  ProgramMetaUpsert,
  ProgramSummary,
  ProgramUpsert,
} from "../types/program";
import type { SettingsMap } from "../types/settings";
import type { UtilityScene, UtilitySceneUpsert } from "../types/utility";
import type { CloseDecision } from "../types/window";

/**
 * The single source of truth for every main<->renderer call. Add a channel here
 * and `registerHandlers` (src/main/ipc/register.ts) forces every handler to exist
 * with the right signature — the old "touch 3 files in lockstep" convention is now
 * a compile error instead of a runtime `undefined`.
 */
export type IpcContract = {
  "displays:list": { req: void; res: DisplayInfo[] };

  "projection:open": { req: { displayId: number }; res: void };
  "projection:close": { req: void; res: void };
  "projection:show": { req: ProjectionOutput; res: void };
  "projection:mediaCommand": { req: MediaCommand; res: void };
  /** The full set of audio tracks that should exist in the projection window
   *  right now — a deck's soundtrack (if any) plus every standalone audio
   *  asset sent live. Replaces the old single-soundtrack channel: audio going
   *  live no longer means "the one audio", it means "one more track". */
  "projection:setAudioTracks": { req: AudioTrackPush[]; res: void };
  /** Pulled once by the projection window on mount so its first paint can
   *  never race the "display-content"/"audio-tracks" pushes that follow a
   *  fresh `projection:open` — see `docs/knowledge/01-architecture.md`. */
  "projection:getSnapshot": {
    req: void;
    res: { output: ProjectionOutput | null; audioTracks: AudioTrackPush[] };
  };
  /** Projection window -> main -> control window. The projection window is
   *  describing its own <video>/<audio> element, not making a decision. */
  "projection:reportMediaStatus": { req: MediaStatus; res: void };
  /** Same direction and same rule as `reportMediaStatus` — the element is
   *  describing its own failure. The projector itself never paints a notice
   *  (the congregation must not see one); it reports, and the control window
   *  is what tells the operator. */
  "projection:reportMediaError": { req: ProjectionMediaError; res: void };

  /** `kind: "all"` combines every `AssetKind`'s extensions into one filter, for
   *  a single file dialog that accepts any supported media at once — the
   *  caller then classifies each returned path by its own extension. */
  "files:pick": { req: { kind: AssetKind | "all"; multiple: boolean }; res: string[] };
  "files:setLogo": { req: void; res: string | null };
  /** Opens a native directory picker. `null` means the user canceled. */
  "files:pickFolder": { req: void; res: string | null };

  /** Cache lookup only — never triggers a conversion, so it is safe to call
   *  while merely rendering a list or selecting an item. */
  "deck:get": { req: { assetId: number }; res: DeckDTO | null };
  /** Converts if needed. Idempotent per assetId: a second call while a
   *  conversion is in flight joins the same job instead of queuing another. */
  "deck:ensure": { req: { assetId: number; force?: boolean }; res: DeckDTO };
  "deck:cancel": { req: { assetId: number }; res: void };
  "deck:environment": { req: void; res: DeckEnvironment };
  /** Opens a native file picker so the user can point at soffice by hand. */
  "deck:locateSoffice": { req: void; res: DeckEnvironment };

  /** Fire-and-forget background conversion for decks not already converted.
   *  The scope is also the priority: main drains `program` before `explicit`
   *  before `visible` before a "Preparar carpeta" batch, and a deck asked for
   *  again under a higher scope is moved up, even if it was already queued.
   *
   *  `"program"` (in the order of service) and `"explicit"` (added via
   *  `+`/drag&drop) never get cancelled by another call; `"visible"` REPLACES
   *  the previous visible set — assets that scrolled out are dropped from the
   *  queue (not-yet-running ones only), assets that scrolled in are added. */
  "deck:prewarm": { req: { assetIds: number[]; scope: "program" | "explicit" | "visible" }; res: void };
  /** Starts one tracked, cancelable batch — the "Preparar carpeta/vista"
   *  button. `assetIds` is whatever the caller already has on screen (the
   *  library tab or linked-folder view's current list); already-converted
   *  ones are skipped and counted separately. Progress comes back on
   *  `prewarm-progress`, keyed by the returned `jobId`. */
  "deck:prewarmBatch": { req: { assetIds: number[]; label: string }; res: { jobId: string; total: number } };
  "deck:cancelPrewarmBatch": { req: { jobId: string }; res: void };
  /** One round-trip instead of one `deck:get` per tile — which of these
   *  assets already have a ready deck (so the "Preparar carpeta" button can
   *  show how many are actually left to convert) and where each ready deck's
   *  first-slide thumbnail lives (so the library grid can draw a PPT tile
   *  without asking for its whole `DeckDTO`). Omits ids with no deck row at
   *  all; check `statuses[id] !== undefined` before assuming "ready". */
  "deck:statuses": { req: { assetIds: number[] }; res: Record<number, DeckStatusSummary> };

  /** How much disk the slide cache is using against its budget. Read-only and
   *  cheap (one aggregate query plus a setting), so Ajustes can poll it on
   *  open without coordinating with the conversion queue. */
  "deck:cacheStats": { req: void; res: DeckCacheStats };
  /** Deletes EVERY cached deck — rows and rasterized files alike — and answers
   *  with the usage that is left. Nothing is spared, including a deck that is
   *  on the projector right now: main deliberately has no way to know what is
   *  live (see `.claude/knowledge/main-cannot-know-what-is-live-under-an-overlay.md`),
   *  so the confirmation belongs to the control window, which does. */
  "deck:clearCache": { req: void; res: DeckCacheStats };

  "bible:versions": { req: void; res: BibleVersionDTO[] };
  "bible:books": { req: { versionId: number }; res: BibleBookDTO[] };
  "bible:chapter": { req: { bookId: number; chapter: number }; res: BibleVerseDTO[] };
  "bible:search": {
    req: { versionId: number; query: string; limit?: number };
    res: BibleSearchHit[];
  };
  "bible:import": { req: void; res: BibleVersionDTO | null };

  "library:list": { req: { kind: AssetKind }; res: MediaAsset[] };
  "library:get": { req: { id: number }; res: MediaAsset | null };
  "library:add": { req: { paths: string[]; kind: AssetKind }; res: MediaAsset[] };
  /** `force: true` bypasses the "in use by a saved program" guard: it also
   *  deletes the referencing `program_items` rows, in the same transaction as
   *  the asset itself. Without it, an asset still in use throws
   *  `MEDIA_ASSET_IN_USE` (see `MediaRepo.remove`). */
  "library:remove": { req: { id: number; force?: boolean }; res: void };
  /** Which saved programs (if any) still reference this asset — used to show
   *  the operator what a forced delete would remove before they confirm it. */
  "library:usages": { req: { id: number }; res: MediaAssetUsage[] };
  "library:relocate": { req: { id: number }; res: MediaAsset | null };
  /** Manual override for a `ppt` asset's linked soundtrack — `path: null`
   *  clears it back to automatic resolution (`linked-audio.ts`). Never
   *  triggers a deck reconversion: the linked audio is served by reference,
   *  not baked into the deck cache. */
  "library:setLinkedAudio": { req: { id: number; path: string | null }; res: MediaAsset | null };
  /** Top-level files of `path` matching `kind`'s extensions, registered the
   *  same way `library:add` does but never marked `inLibrary` — a linked
   *  folder is browsed live, not imported. Returns `[]` if the folder is
   *  gone or unreadable rather than throwing, since it may have been moved
   *  or unmounted since it was linked. */
  "library:listFolder": { req: { kind: AssetKind; path: string }; res: MediaAsset[] };

  "programs:list": { req: void; res: ProgramSummary[] };
  /** ADOPTS the program: main starts attributing `projection_history` to it and
   *  moves the anti-eviction deck pins onto its decks, and the row's
   *  `lastOpenedAt` is bumped. Only the operator actually opening a service
   *  may call this — see `programs:peek` for merely looking at one. */
  "programs:load": { req: { id: number }; res: ProgramDTO };
  /** The same rows, read-only: no `setCurrentProgramId`, no `pinDecks`, no
   *  `lastOpenedAt`. Exists because one click on a row in the programs modal
   *  opens a side panel that lists its items, and doing that through
   *  `programs:load` silently handed the open service's eviction pins and its
   *  history attribution to a program the operator had only glanced at. */
  "programs:peek": { req: { id: number }; res: ProgramDTO };
  "programs:save": { req: ProgramUpsert; res: ProgramSummary };
  "programs:delete": { req: { id: number }; res: void };
  /** "Nuevo programa": the schedule is no longer any saved program, so history
   *  rows must stop being attributed to the last one and its decks stop being
   *  pinned against eviction. Deleting the open program is handled by
   *  `programs:delete` itself — main knows there which id it just removed. */
  "programs:releaseCurrent": { req: void; res: void };
  /** Renames/edits a program's metadata without touching its items or
   *  rewriting their ids — unlike `programs:save`, which always replaces the
   *  full item list. */
  "programs:updateMeta": { req: ProgramMetaUpsert; res: ProgramSummary };
  /** Copies a program's header + items in one transaction on the main side;
   *  never touches the currently loaded program. */
  "programs:duplicate": { req: ProgramDuplicateInput; res: ProgramSummary };
  /** Flips just the favorite flag — deliberately separate from `updateMeta`,
   *  which requires `name` and would clobber `notes` if called partially. */
  "programs:setFavorite": { req: { id: number; favorite: boolean }; res: ProgramSummary };
  /** Applies the operator's manual list order: `ids` is the whole list in the
   *  order it should appear. Returns the re-sorted list so the caller can
   *  replace its state with what actually got persisted instead of trusting
   *  its optimistic guess. */
  "programs:reorder": { req: { ids: number[] }; res: ProgramSummary[] };

  /** Mirrors the unsaved schedule to disk. `null` clears it — sent as soon as
   *  the schedule is saved or emptied, so a stale draft never comes back over
   *  a service the operator already filed. */
  "program:saveDraft": { req: ProgramDraft | null; res: void };
  /** Read once at launch. Already filtered to items whose media assets still
   *  exist (`DraftRepo.load`). */
  "program:loadDraft": { req: void; res: ProgramDraft | null };

  /** The control window's answer to `close-requested`. Main never decides on
   *  its own whether unsaved work may be discarded — `CLAUDE.md`: that
   *  decision belongs to the control window. See `CloseDecision`. */
  "window:closeDecision": { req: { decision: CloseDecision }; res: void };

  /** The saved time scenes, in the operator's manual order. Read once at boot
   *  by `utility.store`, and re-read after every write — the list is small and
   *  main is the only writer, so the store mirrors it rather than patching it.
   *
   *  There is deliberately no `utility:usages` yet: nothing references a scene
   *  until `program_items.kind = 'utility'` lands in F3, so a channel here
   *  could only ever answer with an empty array. It arrives with the FK that
   *  gives it something to look at. */
  "utility:list": { req: void; res: UtilityScene[] };
  /** `id` is ignored on create and required on update — the two are separate
   *  channels rather than one upsert so main never has to guess which one the
   *  editor meant. Both validate the whole scene (`isUtilitySceneUpsert`)
   *  before writing: `registerHandlers` casts from `unknown`, and a row is
   *  durable. */
  "utility:create": { req: UtilitySceneUpsert; res: UtilityScene };
  "utility:update": { req: UtilitySceneUpsert & { id: number }; res: UtilityScene };
  "utility:duplicate": { req: { id: number; name: string }; res: UtilityScene };
  "utility:delete": { req: { id: number }; res: void };
  /** `ids` is the whole list in the order it should appear. Answers with the
   *  re-sorted list, so the caller replaces its state with what was actually
   *  persisted instead of trusting its optimistic guess. */
  "utility:reorder": { req: { ids: number[] }; res: UtilityScene[] };

  "settings:get": { req: void; res: SettingsMap };
  "settings:set": { req: Partial<SettingsMap>; res: void };
};

export type IpcChannel = keyof IpcContract;
export type Req<K extends IpcChannel> = IpcContract[K]["req"];
export type Res<K extends IpcChannel> = IpcContract[K]["res"];

/** Push events: main -> renderer, never invoked by the renderer. */
export type IpcEvents = {
  /** -> projection window */
  "display-content": ProjectionOutput;
  "media-command": MediaCommand;
  "audio-tracks": AudioTrackPush[];
  /** -> control window */
  /** The projection window is gone and the control window did not ask for it:
   *  the OS closed it (the default Electron menu binds Cmd+W and nothing calls
   *  `Menu.setApplicationMenu`), the projection renderer crashed, or it was
   *  force-closed. Without this the control keeps `presentationOpen: true`
   *  forever, and that flag is what `openIfNeeded()` short-circuits on — so EN
   *  VIVO, NEGRO and LOGO would all stop reaching any projector in complete
   *  silence while the LIVE header kept claiming to be on air. */
  "projection-closed": void;
  "media-status": MediaStatus;
  "media-error": ProjectionMediaError;
  "deck-progress": DeckProgress;
  "prewarm-progress": PrewarmProgress;
  /** What `deck:statuses` would answer changed for reasons that are not a
   *  conversion finishing — today, the startup content-hash backfill teaching
   *  main which already-cached deck an asset's bytes belong to. The library
   *  is untouched, so this is deliberately NOT `library-changed`: the grid
   *  must re-ask for statuses without re-listing files. */
  "deck-statuses-changed": { kind: AssetKind };
  "library-changed": { kind: AssetKind };
  /** Only fired for a batch large enough to need a progress bar
   *  (`library-import.ts`'s `PROGRESS_THRESHOLD`), throttled to a few per
   *  second — never one event per file. */
  "library-import-progress": ImportProgress;
  /** The operator asked to close the control window and the schedule has
   *  unsaved changes. Main has already vetoed the close and is asking the
   *  control window what to do; the answer comes back as
   *  `window:confirmClose`, or never, in which case main closes anyway after
   *  a short grace — a wedged renderer must not make the app unquittable. */
  "close-requested": void;
};

export type IpcEventName = keyof IpcEvents;
