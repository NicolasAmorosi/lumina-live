import type { Handlers } from "../register";
import { IpcError } from "@shared/ipc/result";
import {
  listConversions,
  prioritizeConversion,
  retryConversion,
  setDecoderSupport,
} from "../../media/conversion-service";

function assetId(req: { id: number }): number {
  if (!Number.isInteger(req?.id)) throw new IpcError({ code: "INVALID_ARGUMENT", message: "Id inválido." });
  return req.id;
}

export const conversionsHandlers: Pick<
  Handlers,
  "conversion:list" | "conversion:reportDecoders" | "conversion:prioritize" | "conversion:retry"
> = {
  "conversion:list": () => listConversions(),
  "conversion:reportDecoders": (req) => {
    if (typeof req?.hevc !== "boolean" || typeof req.hevcMain10 !== "boolean") {
      throw new IpcError({ code: "INVALID_ARGUMENT", message: "Soporte de decodificadores inválido." });
    }
    setDecoderSupport({ hevc: req.hevc, hevcMain10: req.hevcMain10 });
  },
  "conversion:prioritize": (req) => prioritizeConversion(assetId(req)),
  "conversion:retry": (req) => retryConversion(assetId(req)),
};
