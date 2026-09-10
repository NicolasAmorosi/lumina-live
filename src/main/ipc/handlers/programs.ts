import type { Handlers } from "../register";
import { getProgramsRepo } from "../../services/repos";

export const programsHandlers: Pick<
  Handlers,
  | "programs:list"
  | "programs:load"
  | "programs:save"
  | "programs:delete"
  | "programs:updateMeta"
  | "programs:duplicate"
  | "programs:setFavorite"
  | "programs:reorder"
> = {
  "programs:list": () => getProgramsRepo().list(),
  "programs:load": ({ id }) => getProgramsRepo().load(id),
  "programs:save": (input) => getProgramsRepo().save(input),
  "programs:delete": ({ id }) => {
    getProgramsRepo().delete(id);
  },
  "programs:updateMeta": (input) => getProgramsRepo().updateMeta(input),
  "programs:duplicate": (input) => getProgramsRepo().duplicate(input),
  "programs:setFavorite": ({ id, favorite }) => getProgramsRepo().setFavorite(id, favorite),
  "programs:reorder": ({ ids }) => getProgramsRepo().reorder(ids),
};
