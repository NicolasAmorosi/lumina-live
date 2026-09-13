import type { Handlers } from "../register";
import { projectionState } from "../../services/projection-state";
import { createProjectionWindow } from "../../windows/projection-window";
import { getHistoryRepo, getSlidesRepo } from "../../services/repos";
import { broadcast } from "../../services/broadcast";
import { pinDecks } from "../../slides/deck-service";

let currentProgramId: number | null = null;

export function setCurrentProgramId(id: number | null): void {
  currentProgramId = id;
}

export function getCurrentProgramId(): number | null {
  return currentProgramId;
}

export const projectionHandlers: Pick<
  Handlers,
  | "projection:open"
  | "projection:close"
  | "projection:show"
  | "projection:mediaCommand"
  | "projection:setAudioTracks"
  | "projection:reportMediaStatus"
  | "projection:reportMediaError"
  | "projection:getSnapshot"
> = {
  "projection:open": ({ displayId }) => {
    const existing = projectionState.getWindow();
    if (existing) existing.close();
    const win = createProjectionWindow(displayId);
    projectionState.setWindow(win);
    // Identity-checked (see `clearWindowIf`), and this is load-bearing:
    // `close()` above is asynchronous, so the OLD window's `closed` fires
    // AFTER this line has already registered the new one. Clearing
    // unconditionally left `projectionState.window` at `null` while the new
    // window sat on screen, very much alive — after which no
    // `projection:show` ever reached the projector again (it froze on
    // whatever was last on it) and `projection:close` closed nothing.
    win.on("closed", () => projectionState.clearWindowIf(win));
  },

  "projection:close": () => {
    const win = projectionState.getWindow();
    win?.close();
    projectionState.setWindow(null);
  },

  "projection:show": (output) => {
    projectionState.send(output);
    getHistoryRepo().record(output, currentProgramId);

    // The deck currently on the projector must never be evicted mid-service —
    // this was silently possible before (see `deck-service.ts`'s `pinDecks`),
    // masked only by `evictIfOverCap`'s 24h grace window on recency.
    //
    // NEGRO and LOGO deliberately do NOT clear the pin. They are overlays: the
    // deck is still the base content and comes back the moment the operator
    // lifts them, so unpinning there re-opened the exact hole this closes —
    // three minutes of NEGRO over a deck, an eviction pass in between, and the
    // slides are gone when it comes back up. The pin is released by the next
    // output that genuinely replaces the content (a video, an image, a verse).
    if (output.kind === "slide") {
      const deck = getSlidesRepo().findDeckByAsset(output.deckAssetId);
      pinDecks("projected", deck ? [deck.id] : []);
    } else if (output.kind !== "black" && output.kind !== "logo") {
      pinDecks("projected", []);
    }
  },

  "projection:getSnapshot": () => projectionState.getSnapshot(),

  "projection:mediaCommand": (command) => {
    const win = projectionState.getWindow();
    win?.webContents.send("media-command", command);
  },

  "projection:setAudioTracks": (tracks) => {
    projectionState.setAudioTracks(tracks);
  },

  /** The projection window describing its own media element; forwarded to the
   *  control window, which owns the autoplay clock. */
  "projection:reportMediaStatus": (status) => {
    broadcast("media-status", status);
  },

  /** A file the projector could not load or decode. Logged here as well as
   *  forwarded: the control window's notice is transient by design (it
   *  disappears with the content it describes), so the log is the only record
   *  left for working out afterwards what went wrong during a service. */
  "projection:reportMediaError": (error) => {
    console.warn("[projection] media error", error.target.kind, error.url, error.code);
    broadcast("media-error", error);
  },
};
