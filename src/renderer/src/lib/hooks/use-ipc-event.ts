import { useEffect } from "react";
import type { IpcEventName, IpcEvents } from "@shared/ipc/contract";
import { onIpc } from "@renderer/lib/ipc";

export function useIpcEvent<E extends IpcEventName>(
  event: E,
  callback: (payload: IpcEvents[E]) => void,
): void {
  useEffect(() => onIpc(event, callback), [event, callback]);
}
