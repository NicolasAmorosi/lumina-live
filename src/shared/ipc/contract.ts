import type { AssetKind } from "../constants";
import type { DisplayInfo } from "../types/display";
import type { FileProbe, MediaAsset } from "../types/media";
import type {
  BibleBookDTO,
  BibleSearchHit,
  BibleVerseDTO,
  BibleVersionDTO,
} from "../types/bible";
import type {
  DeckSoundtrackPush,
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
  "projection:setSoundtrack": { req: DeckSoundtrackPush; res: void };
  /** Projection window -> main -> control window. The projection window is
   *  describing its own <video>/<audio> element, not making a decision. */
  "projection:reportMediaStatus": { req: MediaStatus; res: void };

  "files:pick": { req: { kind: AssetKind; multiple: boolean }; res: string[] };
  "files:probe": { req: { path: string }; res: FileProbe };
  "files:setLogo": { req: void; res: string | null };

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
  "library:remove": { req: { id: number }; res: void };
  "library:relocate": { req: { id: number }; res: MediaAsset | null };

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
  "deck-soundtrack": DeckSoundtrackPush;
  /** -> control window */
  "media-status": MediaStatus;
  "deck-progress": DeckProgress;
  "library-changed": { kind: AssetKind };
};

export type IpcEventName = keyof IpcEvents;
