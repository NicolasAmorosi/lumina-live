import { ipcMain, type IpcMainInvokeEvent } from "electron";
import type { IpcChannel, IpcContract, Req, Res } from "@shared/ipc/contract";
import { IpcError, toIpcError, type Result } from "@shared/ipc/result";
import { isTrustedSender } from "./trusted-senders";

export type Handlers = {
  [K in IpcChannel]: (req: Req<K>, ev: IpcMainInvokeEvent) => Promise<Res<K>> | Res<K>;
};

/**
 * Registers every channel in IpcContract at once. Because `handlers` is typed as
 * `Handlers`, omitting a channel or implementing one with the wrong signature is a
 * compile error — the old "touch main.js + preload.js + app.js in the same commit"
 * convention (docs/knowledge/02-ipc-contract.md) is now enforced by the compiler.
 */
export function registerHandlers(handlers: Handlers): void {
  for (const channel of Object.keys(handlers) as IpcChannel[]) {
    ipcMain.handle(channel, async (event, req: unknown) => {
      try {
        // Every channel, without exception — the bridge is generic, so an
        // untrusted caller reaching one reaches all of them. See
        // `trusted-senders.ts` for what this does and does not cover.
        if (!isTrustedSender(event.sender.id)) {
          console.error(`[ipc] rejected ${channel} from untrusted sender ${event.sender.id}`);
          throw new IpcError({ code: "UNTRUSTED_SENDER", message: "Origen no autorizado." });
        }
        const data = await (handlers[channel] as (r: unknown, e: IpcMainInvokeEvent) => unknown)(
          req,
          event,
        );
        return { ok: true, data } satisfies Result<unknown>;
      } catch (error) {
        return { ok: false, error: toIpcError(error) } satisfies Result<unknown>;
      }
    });
  }
}

export type { IpcContract };
