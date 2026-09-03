import { execFile } from "node:child_process";

/**
 * Runs a PowerShell script passed via `-EncodedCommand` (base64 UTF-16LE), the
 * documented way to hand PowerShell a script without going through its own
 * string-interpolation/quoting rules. This replaces the legacy manual escaping
 * (`.replace(/\\/g,'\\\\').replace(/'/g,"''")`, docs/knowledge/03-powerpoint-com.md)
 * which was an injection-adjacent surface: a path containing an unanticipated
 * character could break the script or worse. File paths are never interpolated
 * into the script text — they're passed as process environment variables that
 * the script reads with `$env:NAME`, so nothing about their content is parsed.
 */
export function runPowerShell(
  script: string,
  env: Record<string, string>,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (process.platform !== "win32") {
      reject(new Error("PowerPoint integration is only available on Windows"));
      return;
    }

    const encoded = Buffer.from(script, "utf16le").toString("base64");
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
      { timeout: timeoutMs, windowsHide: true, env: { ...process.env, ...env } },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr?.trim() || error.message));
          return;
        }
        resolve(stdout.trim());
      },
    );
  });
}

/** Fails fast on non-Windows instead of hanging until PPT_OPEN_TIMEOUT_MS /
 *  PPT_EXPORT_TIMEOUT_MS expire — the legacy behavior made macOS/Linux dev
 *  tortuous for anything that touched a PPT handler. */
export function assertWindows(): void {
  if (process.platform !== "win32") {
    throw new Error("UNSUPPORTED_PLATFORM: PowerPoint control requires Windows");
  }
}
