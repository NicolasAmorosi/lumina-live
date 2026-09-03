import type { Handlers } from "../register";
import { getServicesRepo } from "../../services/repos";

export const servicesHandlers: Pick<
  Handlers,
  "services:list" | "services:load" | "services:save" | "services:delete"
> = {
  "services:list": () => getServicesRepo().list(),
  "services:load": ({ id }) => getServicesRepo().load(id),
  "services:save": (input) => getServicesRepo().save(input),
  "services:delete": ({ id }) => {
    getServicesRepo().delete(id);
  },
};
