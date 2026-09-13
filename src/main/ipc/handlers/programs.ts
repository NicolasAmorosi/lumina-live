import type { Handlers } from "../register";
import { getProgramsRepo, getSlidesRepo } from "../../services/repos";
import { pinDecks } from "../../slides/deck-service";
import { getCurrentProgramId, setCurrentProgramId } from "./projection";
import type { ProgramDTO } from "@shared/types/program";

/**
 * Protects the loaded service's decks from LRU eviction, and tags the
 * projection history with the program it belongs to.
 *
 * Both halves existed and neither was wired to anything: `pinDecks`'s
 * `"program"` reason had no caller (so a deck sitting in the open order of
 * service was evictable mid-service, exactly what the pin exists to prevent —
 * masked only by `evictIfOverCap`'s 24h recency grace), and
 * `setCurrentProgramId` had none either, so every `projection_history` row was
 * written with `programId: null`.
 *
 * Pins are by deck id, so an unconverted PPT contributes nothing yet — that is
 * correct: there is no cache directory to protect until it converts, and
 * conversion is what `loadProgram`'s prewarm (renderer side, `"program"` lane)
 * is already asking for.
 */
/** The exact inverse of `adoptProgram`: nothing is the current program any
 *  more, so history stops being attributed and the program's decks go back to
 *  being ordinary eviction candidates. */
function releaseCurrentProgram(): void {
  setCurrentProgramId(null);
  pinDecks("program", []);
}

function adoptProgram(program: ProgramDTO): ProgramDTO {
  setCurrentProgramId(program.id);
  const assetIds = program.items
    .filter((item) => item.kind === "ppt")
    .map((item) => item.mediaAssetId);
  const statuses = getSlidesRepo().statusesByAsset(assetIds);
  pinDecks("program", [...statuses.values()].map((row) => row.deckId));
  return program;
}

export const programsHandlers: Pick<
  Handlers,
  | "programs:list"
  | "programs:load"
  | "programs:save"
  | "programs:delete"
  | "programs:releaseCurrent"
  | "programs:updateMeta"
  | "programs:duplicate"
  | "programs:setFavorite"
  | "programs:reorder"
> = {
  "programs:list": () => getProgramsRepo().list(),
  "programs:load": ({ id }) => adoptProgram(getProgramsRepo().load(id)),
  "programs:save": (input) => {
    const summary = getProgramsRepo().save(input);
    // Saving is also how an unsaved service first gets an id, so the history
    // rows written from here on can be attributed to it.
    adoptProgram(getProgramsRepo().load(summary.id));
    return summary;
  },
  "programs:delete": ({ id }) => {
    getProgramsRepo().delete(id);
    // Deleting the open program left `currentProgramId` pointing at a row that
    // no longer exists, so every `projection_history` row written for the rest
    // of the session was attributed to a deleted service — and its decks stayed
    // pinned against eviction forever, since nothing ever replaced the
    // `"program"` set.
    if (id === getCurrentProgramId()) releaseCurrentProgram();
  },

  "programs:releaseCurrent": () => {
    releaseCurrentProgram();
  },
  "programs:updateMeta": (input) => getProgramsRepo().updateMeta(input),
  "programs:duplicate": (input) => getProgramsRepo().duplicate(input),
  "programs:setFavorite": ({ id, favorite }) => getProgramsRepo().setFavorite(id, favorite),
  "programs:reorder": ({ ids }) => getProgramsRepo().reorder(ids),
};
