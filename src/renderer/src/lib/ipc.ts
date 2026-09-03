import type { IpcChannel, IpcEventName, IpcEvents, Req, Res } from "@shared/ipc/contract";
import { IpcError, type Result } from "@shared/ipc/result";

export async function invoke<K extends IpcChannel>(channel: K, req: Req<K>): Promise<Res<K>> {
  const result = (await window.worship.invoke(channel, req)) as Result<Res<K>>;
  if (!result.ok) throw new IpcError(result.error);
  return result.data;
}

export function onIpc<E extends IpcEventName>(
  event: E,
  callback: (payload: IpcEvents[E]) => void,
): () => void {
  return window.worship.on(event, callback as (payload: unknown) => void);
}
