import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import { ffmpegPath, ffprobePath } from "../paths";

/**
 * The two FFmpeg executables the app ships (`scripts/fetch-ffmpeg.ts`), run as
 * child processes with an argv array — never a shell, so an accented or spaced
 * Windows path reaches them intact.
 *
 * Everything here runs NEXT to a live service. Encodes are started below
 * normal priority, so the projector's decoder always wins the CPU, and every
 * child is tracked so `killAllFfmpeg()` can end them synchronously on quit:
 * nothing asynchronous survives `before-quit`
 * (`.claude/knowledge/nothing-asynchronous-survives-before-quit.md`).
 */

export class FfmpegError extends Error {
  constructor(
    readonly code: "CANCELED" | "STALLED" | "FAILED",
    message: string,
  ) {
    super(message);
    this.name = "FfmpegError";
  }
}

const running = new Set<ChildProcess>();

/** ffprobe answers in milliseconds for a local file. Thirty seconds is a file
 *  on a sleeping network drive, not a slow probe. */
const PROBE_TIMEOUT_MS = 30_000;
/** `-progress` writes a block twice a second while encoding. A minute without
 *  one is a wedged process, not a slow encode. */
const STALL_MS = 60_000;
/** Kept from stderr for the log when ffmpeg fails — its last lines say why. */
const STDERR_TAIL_BYTES = 4096;

export function ffmpegAvailable(): boolean {
  return fs.existsSync(ffmpegPath) && fs.existsSync(ffprobePath);
}

/** Half the cores, at least one: an encode never takes the whole machine from
 *  a projector that may be decoding a 4K video on the CPU. */
export function encoderThreads(): number {
  return Math.max(1, Math.floor(os.availableParallelism() / 2));
}

function track(child: ChildProcess): void {
  running.add(child);
  child.once("close", () => running.delete(child));
}

/** ffprobe's JSON for one file, or null when it cannot read it. Never throws:
 *  a file ffprobe cannot open is an answer ("leave it as it is"), not a fault. */
export function probeMedia(filePath: string): Promise<unknown> {
  return new Promise((resolve) => {
    const child = spawn(
      ffprobePath,
      ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", filePath],
      { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] },
    );
    track(child);
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => child.kill("SIGKILL"), PROBE_TIMEOUT_MS);
    child.stdout?.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.once("error", () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) return resolve(null);
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        resolve(null);
      }
    });
  });
}

/**
 * Runs one ffmpeg command to completion. Rejects with `CANCELED` on abort,
 * `STALLED` when `-progress` goes quiet, and `FAILED` (carrying the tail of
 * stderr) on a non-zero exit.
 */
export function runFfmpeg(
  args: string[],
  opts: { signal: AbortSignal; onProgressChunk?: (chunk: string) => void },
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (opts.signal.aborted) return reject(new FfmpegError("CANCELED", "canceled before start"));

    const child = spawn(ffmpegPath, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    track(child);
    if (child.pid !== undefined) {
      try {
        os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL);
      } catch {
        // Not permitted on this system: the thread cap still applies.
      }
    }

    let stderrTail = "";
    let settled = false;
    let stall: NodeJS.Timeout | null = null;
    const finish = (error: FfmpegError | null) => {
      if (settled) return;
      settled = true;
      if (stall) clearTimeout(stall);
      opts.signal.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve();
    };
    const armStall = () => {
      if (stall) clearTimeout(stall);
      stall = setTimeout(() => {
        child.kill("SIGKILL");
        finish(new FfmpegError("STALLED", `no progress for ${STALL_MS / 1000} s`));
      }, STALL_MS);
    };
    const onAbort = () => {
      child.kill("SIGKILL");
      finish(new FfmpegError("CANCELED", "canceled"));
    };

    opts.signal.addEventListener("abort", onAbort, { once: true });
    armStall();
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      armStall();
      opts.onProgressChunk?.(chunk);
    });
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      stderrTail = (stderrTail + chunk).slice(-STDERR_TAIL_BYTES);
    });
    child.once("error", (error) => finish(new FfmpegError("FAILED", error.message)));
    child.once("close", (code) => {
      if (code === 0) finish(null);
      else finish(new FfmpegError("FAILED", `ffmpeg exited with ${code}: ${stderrTail.trim()}`));
    });
  });
}

/**
 * One JPEG frame, `width` px wide, for a library tile whose video the OS
 * thumbnailer cannot read (QuickLook has no AVI, WMV or MKV). One second in,
 * past the black most clips open on, and from the start for anything shorter.
 * Runs in its own process, so unlike `nativeImage` it never stalls main.
 */
export async function grabFrame(filePath: string, width: number): Promise<Buffer | null> {
  return (await grabFrameAt(filePath, width, 1)) ?? grabFrameAt(filePath, width, 0);
}

function grabFrameAt(filePath: string, width: number, atSec: number): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const child = spawn(
      ffmpegPath,
      [
        ...["-hide_banner", "-nostdin", "-loglevel", "error", "-ss", String(atSec), "-i", filePath],
        ...["-frames:v", "1", "-vf", `scale=${width}:-2`, "-f", "image2pipe", "-c:v", "mjpeg", "-q:v", "4", "pipe:1"],
      ],
      { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] },
    );
    track(child);
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => child.kill("SIGKILL"), PROBE_TIMEOUT_MS);
    child.stdout?.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.once("error", () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      const jpeg = Buffer.concat(chunks);
      resolve(code === 0 && jpeg.length > 0 ? jpeg : null);
    });
  });
}

/** For `before-quit`: synchronous, and a plain kill is enough — ffmpeg and
 *  ffprobe start no children of their own. */
export function killAllFfmpeg(): void {
  for (const child of running) {
    try {
      child.kill("SIGKILL");
    } catch {
      // Already gone.
    }
  }
  running.clear();
}
