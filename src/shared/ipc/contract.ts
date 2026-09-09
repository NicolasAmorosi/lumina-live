import type { AssetKind } from "../constants";
import type { DisplayInfo } from "../types/display";
import type { FileProbe, MediaAsset, MediaAssetUsage } from "../types/media";
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
  ProjectionOutput,
} from "../types/projection";
import type { DeckDTO, DeckEnvironment, DeckProgress } from "../types/deck";
import type { ServiceDTO, ServiceSummary, ServiceUpsert } from "../types/service";
import type { SettingsMap } from "../types/settings";

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

  /** `kind: "all"` combines every `AssetKind`'s extensions into one filter, for
   *  a single file dialog that accepts any supported media at once — the
   *  caller then classifies each returned path by its own extension. */
  "files:pick": { req: { kind: AssetKind | "all"; multiple: boolean }; res: string[] };
  "files:probe": { req: { path: string }; res: FileProbe };
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
  "deck:progress": { req: { assetId: number }; res: DeckProgress | null };
  "deck:environment": { req: void; res: DeckEnvironment };
  /** Opens a native file picker so the user can point at soffice by hand. */
  "deck:locateSoffice": { req: void; res: DeckEnvironment };

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
  /** `force: true` bypasses the "in use by a saved service" guard: it also
   *  deletes the referencing `service_items` rows, in the same transaction as
   *  the asset itself. Without it, an asset still in use throws
   *  `MEDIA_ASSET_IN_USE` (see `MediaRepo.remove`). */
  "library:remove": { req: { id: number; force?: boolean }; res: void };
  /** Which saved services (if any) still reference this asset — used to show
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

  "services:list": { req: void; res: ServiceSummary[] };
  "services:load": { req: { id: number }; res: ServiceDTO };
  "services:save": { req: ServiceUpsert; res: ServiceSummary };
  "services:delete": { req: { id: number }; res: void };

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
  "media-status": MediaStatus;
  "deck-progress": DeckProgress;
  "library-changed": { kind: AssetKind };
};

export type IpcEventName = keyof IpcEvents;
