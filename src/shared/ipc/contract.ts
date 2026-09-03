import type { AssetKind } from "../constants";
import type { DisplayInfo } from "../types/display";
import type { FileProbe, MediaAsset } from "../types/media";
import type {
  BibleBookDTO,
  BibleSearchHit,
  BibleVerseDTO,
  BibleVersionDTO,
} from "../types/bible";
import type { ProjectionOutput, VideoCommand, VideoStatus } from "../types/projection";
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
  "projection:setOverlayVisible": { req: { visible: boolean }; res: void };
  "projection:videoCommand": { req: VideoCommand; res: void };

  "files:pick": { req: { kind: AssetKind; multiple: boolean }; res: string[] };
  "files:probe": { req: { path: string }; res: FileProbe };
  "files:setLogo": { req: void; res: string | null };

  "ppt:open": { req: { assetId: number }; res: { success: boolean; totalSlides: number } };
  "ppt:next": { req: void; res: void };
  "ppt:prev": { req: void; res: void };
  "ppt:goto": { req: { slide: number }; res: void };
  "ppt:currentSlide": { req: void; res: number };
  "ppt:close": { req: void; res: void };
  "ppt:exportSlides": { req: { assetId: number }; res: { sessionId: string; urls: string[] } };

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
  "display-content": ProjectionOutput;
  "video-command": VideoCommand;
  "video-status": VideoStatus;
  "library-changed": { kind: AssetKind };
  "ppt-slide-changed": { slide: number };
};

export type IpcEventName = keyof IpcEvents;
