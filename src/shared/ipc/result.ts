export type IpcErrorPayload = {
  code: string;
  message: string;
};

export type Result<T> = { ok: true; data: T } | { ok: false; error: IpcErrorPayload };

export class IpcError extends Error {
  code: string;

  constructor(payload: IpcErrorPayload) {
    super(payload.message);
    this.code = payload.code;
    this.name = "IpcError";
  }
}

export function toIpcError(error: unknown): IpcErrorPayload {
  if (error instanceof IpcError) return { code: error.code, message: error.message };
  if (error instanceof Error) return { code: "UNKNOWN", message: error.message };
  return { code: "UNKNOWN", message: String(error) };
}
