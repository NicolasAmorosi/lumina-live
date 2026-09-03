import { ipcMain, type IpcMainInvokeEvent } from "electron";
import type { IpcChannel, IpcContract, Req, Res } from "@shared/ipc/contract";
import { toIpcError, type Result } from "@shared/ipc/result";

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
