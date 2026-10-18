import { IpcError } from "@shared/ipc/result";

/**
 * A closed set of failure reasons for the conversion pipeline. `toIpcError`
 * (shared/ipc/result.ts) preserves `.code` for an IpcError and flattens
 * everything else to "UNKNOWN", so the renderer can tell "install LibreOffice"
 * apart from "this file is corrupt" without parsing a message string.
 */
export type SlideErrorCode =
  | "SOFFICE_NOT_FOUND"
  | "SOFFICE_NOT_EXECUTABLE"
  | "SOFFICE_UNSUPPORTED_FLAVOR"
  | "SOFFICE_FAILED"
  | "SOFFICE_TIMEOUT"
  | "PDF_MISSING"
  | "PDF_PASSWORD"
  | "RASTER_FAILED"
  | "SOURCE_MISSING"
  | "NOT_A_PRESENTATION"
  | "DISK_FULL"
  | "CANCELED";

export class SlideError extends IpcError {
  readonly slideCode: SlideErrorCode;

  constructor(code: SlideErrorCode, message: string, cause?: unknown) {
    super({ code, message });
    this.slideCode = code;
    this.name = "SlideError";
    if (cause !== undefined) this.cause = cause;
  }
}

export function isSlideError(error: unknown): error is SlideError {
  return error instanceof SlideError;
}
