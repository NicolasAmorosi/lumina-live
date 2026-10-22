import { execFile, execFileSync, spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { SOFFICE_PROBE_TIMEOUT_MS } from "@shared/constants";
import { sofficeProfileDir } from "../paths";
import { getSettingsRepo } from "../services/repos";
import { SlideError, isSlideError } from "./errors";
import { mt } from "../i18n";

export type SofficeFlavor = "native" | "flatpak" | "snap";

export type SofficeInfo = {
  path: string;
  version: string;
  major: number;
  source: "setting" | "env" | "cached" | "candidate" | "path";
  flavor: SofficeFlavor;
};

export type SofficeStatus =
  | { available: true; info: SofficeInfo }
  | {
      available: false;
      reason: "not-found" | "not-executable" | "probe-failed" | "unsupported-flavor";
      message: string;
      checkedPaths: string[];
      overridePath: string | null;
    };

function isExecutable(candidate: string): boolean {
  try {
    fs.accessSync(candidate, fs.constants.X_OK);
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

function flavorOf(exe: string): SofficeFlavor {
  if (exe.includes("/snap/")) return "snap";
  if (exe.includes("flatpak")) return "flatpak";
  return "native";
}

/** Newest-first `/opt/libreoffice*` installs, without pulling in a glob dep. */
function optLibreOfficePaths(): string[] {
  try {
    return fs
      .readdirSync("/opt")
      .filter((entry) => entry.startsWith("libreoffice"))
      .sort()
      .reverse()
      .map((entry) => path.join("/opt", entry, "program", "soffice"));
  } catch {
    return [];
  }
}

export function candidatePaths(): string[] {
  const home = os.homedir();

  if (process.platform === "darwin") {
    return [
      "/Applications/LibreOffice.app/Contents/MacOS/soffice",
      path.join(home, "Applications/LibreOffice.app/Contents/MacOS/soffice"),
      "/opt/homebrew/bin/soffice",
      "/usr/local/bin/soffice",
    ];
  }

  if (process.platform === "win32") {
    const programFiles = process.env["ProgramFiles"] ?? "C:\\Program Files";
    const programFilesX86 = process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
    const localAppData = process.env["LOCALAPPDATA"] ?? path.join(home, "AppData", "Local");
    const roots = [
      path.join(programFiles, "LibreOffice", "program"),
      path.join(programFilesX86, "LibreOffice", "program"),
      path.join(localAppData, "Programs", "LibreOffice", "program"),
    ];
    // soffice.com BEFORE soffice.exe: the .exe detaches and returns before the
    // PDF exists, so execFile resolves against a file that isn't written yet.
    // The .com console wrapper blocks until the conversion actually finishes.
    return [
      ...roots.map((root) => path.join(root, "soffice.com")),
      ...roots.map((root) => path.join(root, "soffice.exe")),
    ];
  }

  return [
    "/usr/bin/soffice",
    "/usr/bin/libreoffice",
    "/usr/local/bin/soffice",
    "/snap/bin/libreoffice",
    "/var/lib/flatpak/exports/bin/org.libreoffice.LibreOffice",
    path.join(home, ".local/share/flatpak/exports/bin/org.libreoffice.LibreOffice"),
    ...optLibreOfficePaths(),
  ];
}

/** Explicit PATH walk rather than shelling out to `which`/`where` — a
 *  GUI-launched app on macOS inherits a stub PATH anyway, which is exactly why
 *  the candidate list above runs first. */
function pathLookup(): string[] {
  const raw = process.env["PATH"];
  if (!raw) return [];
  const names =
    process.platform === "win32"
      ? ["soffice.com", "soffice.exe", "libreoffice.com", "libreoffice.exe"]
      : ["soffice", "libreoffice"];
  const found: string[] = [];
  for (const dir of raw.split(path.delimiter)) {
    if (!dir) continue;
    for (const name of names) found.push(path.join(dir, name));
  }
  return found;
}

/** A cold first launch on a slow Windows PC — Defender scanning a freshly
 *  installed LibreOffice — can take most of the ten seconds just to answer. */
const PROBE_TIMEOUT_MS = process.platform === "win32" ? 3 * SOFFICE_PROBE_TIMEOUT_MS : SOFFICE_PROBE_TIMEOUT_MS;

export async function probeVersion(
  exe: string,
): Promise<{ version: string; major: number } | null> {
  return new Promise((resolve) => {
    execFile(
      exe,
      // On our own profile, like every conversion: with Impress open on the
      // default one, `--version` can wait on that instance instead of answering.
      ["--version", ...profileArgs()],
      { timeout: PROBE_TIMEOUT_MS, windowsHide: true },
      (error, stdout) => {
        if (error) {
          resolve(null);
          return;
        }
        const match = /LibreOffice\s+(\d+)\.(\d+)[\d.]*/i.exec(stdout);
        if (!match) {
          resolve(null);
          return;
        }
        resolve({ version: match[0].replace(/^LibreOffice\s+/i, ""), major: Number(match[1]) });
      },
    );
  });
}

let cached: SofficeStatus | null = null;

export function cachedSofficeStatus(): SofficeStatus | null {
  return cached;
}

export function invalidateSofficeCache(): void {
  cached = null;
}

async function buildStatus(exe: string, source: SofficeInfo["source"]): Promise<SofficeStatus> {
  const flavor = flavorOf(exe);
  if (flavor !== "native") {
    // Flatpak/snap sandbox the filesystem: our userData profile directory and a
    // deck sitting on a USB stick would both be unreachable, and the failure
    // surfaces as an opaque timeout rather than a permission error.
    return {
      available: false,
      reason: "unsupported-flavor",
      message: mt("slides.sofficeSandboxed"),
      checkedPaths: [exe],
      overridePath: null,
    };
  }
  const probed = await probeVersion(exe);
  if (!probed) {
    return {
      available: false,
      reason: "probe-failed",
      message: mt("slides.sofficeNoVersion", { path: exe }),
      checkedPaths: [exe],
      overridePath: null,
    };
  }
  return {
    available: true,
    info: { path: exe, version: probed.version, major: probed.major, source, flavor },
  };
}

/** The search in flight right now, so concurrent callers share one sweep. */
let inFlightLocate: Promise<SofficeStatus> | null = null;

/**
 * Cached, and deduplicated across concurrent callers.
 *
 * The sweep is expensive in the worst case: every candidate path plus a `PATH`
 * lookup, each surviving entry probed with `--version` under a 10 s timeout. On
 * a machine without LibreOffice that is the full timeout budget — and two
 * `deck:environment` calls landing together (the settings panel and the slide
 * grid both ask on mount) paid it twice, in parallel, for an answer that is by
 * definition the same.
 *
 * A `force` call never joins an in-flight sweep: forcing exists precisely
 * because the inputs changed (a new override path was just saved), so it starts
 * its own — and becomes the sweep that later callers join.
 */
export function locateSoffice(opts?: { force?: boolean }): Promise<SofficeStatus> {
  if (!opts?.force) {
    if (cached) return Promise.resolve(cached);
    inFlightLocate ??= startLocate();
    return inFlightLocate;
  }
  return startLocate();
}

function startLocate(): Promise<SofficeStatus> {
  const search = runLocateSoffice().finally(() => {
    if (inFlightLocate === search) inFlightLocate = null;
  });
  inFlightLocate = search;
  return search;
}

async function runLocateSoffice(): Promise<SofficeStatus> {
  const settings = getSettingsRepo();
  const override = settings.get("slides.sofficePath");

  // A user-set override is authoritative: if it's broken, say so instead of
  // silently autodetecting something else and leaving the wrong path invisible.
  if (override) {
    const status: SofficeStatus = isExecutable(override)
      ? await buildStatus(override, "setting")
      : {
          available: false,
          reason: "not-executable",
          message: mt("slides.sofficeNotExecutable", { path: override }),
          checkedPaths: [override],
          overridePath: override,
        };
    cached = status;
    return status;
  }

  const checked: string[] = [];
  const ordered: Array<{ exe: string; source: SofficeInfo["source"] }> = [];

  const fromEnv = process.env["WORSHIP_SOFFICE_PATH"];
  if (fromEnv) ordered.push({ exe: fromEnv, source: "env" });

  const remembered = settings.get("slides.sofficePathResolved");
  if (remembered) ordered.push({ exe: remembered, source: "cached" });

  for (const exe of candidatePaths()) ordered.push({ exe, source: "candidate" });
  for (const exe of pathLookup()) ordered.push({ exe, source: "path" });

  let probeFailure: SofficeStatus | null = null;
  for (const { exe, source } of ordered) {
    checked.push(exe);
    if (!isExecutable(exe)) continue;
    const status = await buildStatus(exe, source);
    if (status.available) {
      settings.setMany({ "slides.sofficePathResolved": status.info.path });
      cached = status;
      return status;
    }
    if (status.reason === "unsupported-flavor") {
      cached = status;
      return status;
    }
    probeFailure ??= status;
  }

  // Installed but not answering is not "not installed": saying so sent the
  // operator to install something that was already there.
  cached = probeFailure
    ? { ...probeFailure, checkedPaths: checked }
    : {
        available: false,
        reason: "not-found",
        message: mt("slides.sofficeNotFound"),
        checkedPaths: checked,
        overridePath: null,
      };
  return cached;
}

export async function requireSoffice(): Promise<SofficeInfo> {
  let status = await locateSoffice();
  // A failed sweep is cached for the panels that only DISPLAY the answer, but
  // a conversion about to fail on it looks again: the startup probe can time
  // out on a cold machine, and that must not mean "no presentations today".
  if (!status.available && status.reason !== "unsupported-flavor") status = await locateSoffice({ force: true });
  if (!status.available) {
    const code =
      status.reason === "not-executable"
        ? "SOFFICE_NOT_EXECUTABLE"
        : status.reason === "unsupported-flavor"
          ? "SOFFICE_UNSUPPORTED_FLAVOR"
          : "SOFFICE_NOT_FOUND";
    throw new SlideError(code, status.message);
  }
  return status.info;
}

// ---------------------------------------------------------------------------
// Conversion
// ---------------------------------------------------------------------------

let running: ChildProcess | null = null;

/** How much of `soffice`'s stderr is worth keeping for an error message. */
const STDERR_CAP_BYTES = 8 * 1024;

/** How long a killed `soffice` gets to exit on its own before the SIGKILL —
 *  except on the shutdown path, which has no such time (see `killTree`). */
const KILL_GRACE_MS = 5000;

/**
 * Kills the whole process group: soffice.com/soffice delegates to soffice.bin,
 * so killing only the direct child orphans the real worker.
 *
 * `immediate` is the shutdown path, and it is not an optimization — it is the
 * only version that works there. A `setTimeout` armed during `before-quit`
 * never fires: the process is gone long before 5 s, so the backup SIGKILL had
 * simply never run, and a `soffice` that ignored the SIGTERM (a long
 * conversion mid-render does) survived the app. Because children are spawned
 * `detached`, that survivor keeps the shared profile's lock file and named
 * pipe, and every conversion on the *next* start then fails silently — the
 * exact failure `-env:UserInstallation` exists to prevent.
 */
function killTree(child: ChildProcess, immediate = false): void {
  const { pid } = child;
  if (pid === undefined) return;

  if (process.platform === "win32") {
    const args = ["/pid", String(pid), "/T", "/F"];
    if (immediate) {
      // Synchronous for the same reason: nothing waits for the callback.
      try {
        execFileSync("taskkill", args, { windowsHide: true, stdio: "ignore" });
      } catch {
        /* already gone */
      }
      return;
    }
    execFile("taskkill", args, { windowsHide: true }, () => {});
    return;
  }

  const signalGroup = (signal: NodeJS.Signals) => {
    try {
      process.kill(-pid, signal);
    } catch {
      try {
        child.kill(signal);
      } catch {
        /* already gone */
      }
    }
  };

  signalGroup("SIGTERM");
  if (immediate) {
    signalGroup("SIGKILL");
    return;
  }
  setTimeout(() => {
    if (child.exitCode !== null) return;
    signalGroup("SIGKILL");
  }, KILL_GRACE_MS).unref();
}

/** Called from `before-quit`, where nothing asynchronous gets to run — hence
 *  the unconditional force. */
export function killRunningSoffice(): void {
  if (running) killTree(running, true);
  running = null;
}

/** `pkill -f` takes an extended regular expression, and the profile path is
 *  under the user's data directory — which routinely contains `.` and can
 *  contain brackets or parentheses. */
function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Kills a `soffice` orphaned by a crash of the app itself, which skips
 * `before-quit` entirely. Matched by our own `-env:UserInstallation` argument,
 * so it can only ever hit a process this app launched — a copy of LibreOffice
 * the user has open as a normal GUI app runs on the default profile and is
 * never touched.
 *
 * Best-effort and non-blocking: `pkill` exits 1 when nothing matched, which is
 * the normal case. On Windows there is no `pkill`, and no built-in that can
 * filter processes by command line except WMI, so it goes through PowerShell.
 * That case matters MORE there: a «Finalizar tarea» on a frozen app leaves
 * `soffice.bin` holding the profile, `resetSofficeProfile` cannot delete a
 * locked folder, and every conversion kept failing until a reboot.
 */
export async function reapOrphanedSoffice(): Promise<void> {
  const marker = `-env:UserInstallation=${pathToFileURL(sofficeProfileDir).href}`;
  if (process.platform === "win32") {
    // Single quotes are PowerShell's literal strings; a quote inside one is
    // doubled. `.Contains`, not `-like`, so brackets in the path stay literal.
    const literal = marker.replaceAll("'", "''");
    const script =
      "Get-CimInstance Win32_Process -Filter \"Name='soffice.bin' OR Name='soffice.exe' OR Name='soffice.com'\" | " +
      `Where-Object { $_.CommandLine -and $_.CommandLine.Contains('${literal}') } | ` +
      "Invoke-CimMethod -MethodName Terminate | Out-Null";
    await new Promise<void>((resolve) => {
      execFile(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", script],
        { windowsHide: true, timeout: 20_000 },
        () => resolve(),
      );
    });
    return;
  }
  await new Promise<void>((resolve) => {
    execFile("pkill", ["-f", "--", escapeForRegex(marker)], () => resolve());
  });
}

type RunOptions = {
  info: SofficeInfo;
  args: string[];
  timeoutMs: number;
  signal?: AbortSignal;
};

/** Every `soffice` invocation shares one `-env:UserInstallation` profile
 *  (`baseArgs()` below), which means its own lock file and named pipe: a
 *  second instance launched while the first is still running exits with code
 *  1 and produces nothing, silently. Verified against a real `.pps` — the
 *  `Promise.all` in `deck-service.ts` used to fire `convertToPdf` and the
 *  legacy-binary `convertToPptx` upgrade pass at the same time, and the
 *  second one always lost the race. A module-level chain serializes every
 *  call through here so no future caller can reintroduce the race. */
let sofficeChain: Promise<void> = Promise.resolve();

/** How long the chain waits for a killed `soffice` to actually exit before
 *  forcing it and moving on regardless. */
const EXIT_WAIT_MS = 10_000;

function runSoffice(options: RunOptions): Promise<void> {
  const started = sofficeChain.then(() => startSoffice(options));
  // The next invocation waits for this PROCESS to be gone, not merely for its
  // caller to have been told. A cancel or a timeout settles the caller at
  // once, but the killed instance keeps the shared profile's lock and pipe
  // until it exits — and on Windows `taskkill` is itself asynchronous — so a
  // conversion started in that window exited 1 with nothing to show: the
  // interactive EN VIVO that had just preempted a «Preparar carpeta» batch.
  // Rejections are swallowed here so one failure never wedges the chain;
  // callers still get their own through `done`.
  sofficeChain = started.then((run) => run.exited).catch(() => undefined);
  return started.then((run) => run.done);
}

function startSoffice(options: RunOptions): { done: Promise<void>; exited: Promise<void> } {
  let child: ChildProcess | null = null;
  const done = runSofficeExclusive(options, (spawned) => {
    child = spawned;
  });
  const spawned = child as ChildProcess | null;
  const exited = spawned
    ? new Promise<void>((resolve) => {
        if (spawned.exitCode !== null || spawned.signalCode !== null) return resolve();
        spawned.once("close", () => resolve());
        // Never forever: a process that ignores even this is not worth
        // stalling every later conversion for.
        done.catch(() => {
          // Never spawned at all (a wrong path): there is nothing to wait for.
          if (spawned.pid === undefined || spawned.exitCode !== null) return resolve();
          setTimeout(() => {
            if (spawned.exitCode === null) killTree(spawned, true);
            resolve();
          }, EXIT_WAIT_MS).unref();
        });
      })
    : Promise.resolve();
  return { done, exited };
}

function runSofficeExclusive(
  { info, args, timeoutMs, signal }: RunOptions,
  onSpawn: (child: ChildProcess) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new SlideError("CANCELED", mt("slides.canceled")));
      return;
    }

    const child = spawn(info.path, args, {
      windowsHide: true,
      // Own process group so killTree can take down soffice.bin with it.
      detached: process.platform !== "win32",
      // stdout is IGNORED, not piped: a piped stream nobody reads fills the
      // OS pipe buffer (~64 KB) and then BLOCKS the child until the timeout
      // kills it — a deadlock that would look exactly like LibreOffice
      // hanging. `--convert-to` prints one line per converted file, so a
      // large enough batch reaches that on its own. Nothing reads stdout
      // anyway; the outputs are found by listing `--outdir`.
      stdio: ["ignore", "ignore", "pipe"],
      env: {
        ...process.env,
        // OpenCL in headless mode on a flaky GPU driver is a known hang source.
        SAL_DISABLE_OPENCL: "1",
      },
    });
    running = child;
    onSpawn(child);

    // Capped: this only ever ends up in an error message, and a chatty deck
    // can produce megabytes of warnings over a conversion that is allowed to
    // run for minutes.
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderr.length >= STDERR_CAP_BYTES) return;
      stderr += chunk.toString();
    });

    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (running === child) running = null;
      fn();
    };

    const timer = setTimeout(() => {
      killTree(child);
      finish(() =>
        reject(
          new SlideError(
            "SOFFICE_TIMEOUT",
            mt("slides.sofficeTimeout", { seconds: Math.round(timeoutMs / 1000) }),
          ),
        ),
      );
    }, timeoutMs);

    const onAbort = () => {
      killTree(child);
      finish(() => reject(new SlideError("CANCELED", mt("slides.canceled"))));
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    child.on("error", (error) =>
      finish(() => reject(new SlideError("SOFFICE_FAILED", error.message, error))),
    );

    child.on("close", (code) => {
      finish(() => {
        if (code === 0) resolve();
        else
          reject(
            new SlideError(
              "SOFFICE_FAILED",
              mt("slides.sofficeExit", { code: String(code), detail: stderr.trim() }).trim(),
            ),
          );
      });
    });
  });
}

function baseArgs(): string[] {
  return ["--headless", "--invisible", "--nologo", "--nodefault", "--norestore", "--nolockcheck", ...profileArgs()];
}

/** A dedicated UserInstallation gets its own lock file and named pipe, which
 *  is what makes us immune to a copy of LibreOffice the user has open as a
 *  normal GUI app (the classic "conversion silently does nothing" failure). */
function profileArgs(): string[] {
  return [`-env:UserInstallation=${pathToFileURL(sofficeProfileDir).href}`];
}

/** Arguments always travel as an argv array (never a shell string), so quoting
 *  can't be exploited. The one real hazard is argument confusion — a file named
 *  `-env:foo` would parse as an option — which resolving to an absolute path
 *  rules out. */
function assertSafeSourcePath(sourcePath: string): string {
  const abs = path.resolve(sourcePath);
  if (!path.isAbsolute(abs)) {
    throw new SlideError("SOURCE_MISSING", mt("slides.invalidSource", { path: sourcePath }));
  }
  return abs;
}

function findOutput(outDir: string, ext: string): string | null {
  // LibreOffice mangles the basename for unusual characters in ways not worth
  // predicting; outDir is freshly created and empty, so just look inside it.
  const match = fs.readdirSync(outDir).find((f) => f.toLowerCase().endsWith(ext));
  return match ? path.join(outDir, match) : null;
}

export function convertTimeoutFor(sizeBytes: number): number {
  return Math.min(600_000, 60_000 + Math.ceil(sizeBytes / 1_000_000) * 4_000);
}

/** A batch invocation still only pays LibreOffice's startup cost once, but
 *  needs a timeout that covers every file in it — the per-file formula times
 *  the count, generously capped so one huge batch can't hang for hours. */
export function convertTimeoutForBatch(totalSizeBytes: number, fileCount: number): number {
  return Math.min(1_800_000, 60_000 + Math.ceil(totalSizeBytes / 1_000_000) * 4_000 + fileCount * 2_000);
}

export type ConvertOptions = {
  sourcePath: string;
  outDir: string;
  timeoutMs: number;
  signal?: AbortSignal;
};

/** Name the Impress filter explicitly so a .ppsx can't get routed through
 *  Writer's or Draw's PDF export. */
function pdfFilterFor(info: SofficeInfo): string {
  return info.major >= 8 || info.major >= 7
    ? 'pdf:impress_pdf_Export:{"ReduceImageResolution":{"type":"boolean","value":"false"},"Quality":{"type":"long","value":"100"}}'
    : "pdf:impress_pdf_Export";
}

/** Normalized for matching a batch's output files back to their sources:
 *  LibreOffice writes `<basename>.<ext>` verbatim (mangling only characters
 *  it can't represent), and file names round-trip differently across
 *  filesystems (macOS favors NFD, Windows/old decks favor NFC) — the same
 *  normalization `linked-audio.ts` uses for the same reason. */
function normalizedBase(filePath: string): string {
  return path.basename(filePath, path.extname(filePath)).normalize("NFC").toLowerCase();
}

/** Maps every source path that produced a matching output file in `outDir`
 *  to that file's absolute path. A source with no match (name mangled beyond
 *  recognition, or never converted because the batch was interrupted before
 *  reaching it) is simply absent — callers fall back to converting it alone. */
function matchOutputsToSources(
  outDir: string,
  ext: string,
  sourcePaths: readonly string[],
): Map<string, string> {
  const byBase = new Map<string, string>();
  for (const file of fs.readdirSync(outDir)) {
    if (!file.toLowerCase().endsWith(ext)) continue;
    byBase.set(normalizedBase(file), path.join(outDir, file));
  }
  const sources = new Map<string, number>();
  for (const source of sourcePaths) {
    const base = normalizedBase(source);
    sources.set(base, (sources.get(base) ?? 0) + 1);
  }
  const result = new Map<string, string>();
  for (const source of sourcePaths) {
    const base = normalizedBase(source);
    // Two sources with one output name — a weekly `Anuncios.pptx` in two
    // folders, or `522.pps` beside `522.pptx` — overwrote each other in the
    // shared `--outdir`, and the survivor was handed to BOTH, then cached
    // under the first one's content hash: that deck showed the other one's
    // slides until someone forced a reconversion. Neither result can be
    // trusted, so both fall back to converting on their own.
    if ((sources.get(base) ?? 0) > 1) continue;
    const match = byBase.get(base);
    if (match) result.set(source, match);
  }
  return result;
}

export type BatchConvertOptions = {
  sourcePaths: readonly string[];
  outDir: string;
  timeoutMs: number;
  signal?: AbortSignal;
};

/** One `soffice` invocation for every source path in the batch, instead of
 *  one invocation per file — LibreOffice's own startup cost (loading the
 *  application, not the document) dwarfs the per-file conversion cost, so
 *  batching a background prewarm this way is where most of the wall-clock
 *  savings for a large folder import come from. Only used for background
 *  (prewarm) work: `deck:ensure`'s interactive path still converts one file
 *  at a time, where batching would only add latency.
 *
 *  Best-effort against interruption: if the invocation times out or is
 *  soft-preempted, whatever files LibreOffice finished BEFORE that (it
 *  converts sequentially within one process, writing each output before
 *  moving to the next) are still real PDFs sitting in `outDir` — matching
 *  against whatever is actually there, instead of throwing the whole batch
 *  away, is what lets a preempted prewarm batch keep its partial progress.
 *  A source with no match just falls through to the per-file path. */
export async function convertBatchToPdf(options: BatchConvertOptions): Promise<Map<string, string>> {
  const info = await requireSoffice();
  const abs = options.sourcePaths.map(assertSafeSourcePath);
  const filter = pdfFilterFor(info);

  try {
    await runSoffice({
      info,
      args: [...baseArgs(), "--convert-to", filter, "--outdir", options.outDir, ...abs],
      timeoutMs: options.timeoutMs,
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (error) {
    if (!isSlideError(error) || (error.slideCode !== "CANCELED" && error.slideCode !== "SOFFICE_TIMEOUT")) {
      throw error;
    }
  }

  return matchOutputsToSources(options.outDir, ".pdf", abs);
}

/** Batch counterpart to `convertToPptx` — the legacy `.ppt`/`.pps` → `.pptx`
 *  upgrade pass, for however many of the batch's decks are legacy binaries.
 *  Same best-effort-against-interruption behavior as `convertBatchToPdf`. */
export async function convertBatchToPptx(options: BatchConvertOptions): Promise<Map<string, string>> {
  const info = await requireSoffice();
  const abs = options.sourcePaths.map(assertSafeSourcePath);

  try {
    await runSoffice({
      info,
      args: [
        ...baseArgs(),
        "--convert-to",
        "pptx:Impress MS PowerPoint 2007 XML",
        "--outdir",
        options.outDir,
        ...abs,
      ],
      timeoutMs: options.timeoutMs,
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (error) {
    if (!isSlideError(error) || (error.slideCode !== "CANCELED" && error.slideCode !== "SOFFICE_TIMEOUT")) {
      throw error;
    }
  }

  return matchOutputsToSources(options.outDir, ".pptx", abs);
}

export async function convertToPdf(options: ConvertOptions): Promise<string> {
  const info = await requireSoffice();
  const abs = assertSafeSourcePath(options.sourcePath);
  const filter = pdfFilterFor(info);

  await runSoffice({
    info,
    args: [...baseArgs(), "--convert-to", filter, "--outdir", options.outDir, abs],
    timeoutMs: options.timeoutMs,
    ...(options.signal ? { signal: options.signal } : {}),
  });

  const pdf = findOutput(options.outDir, ".pdf");
  if (!pdf) {
    // soffice frequently exits 0 having produced nothing at all.
    throw new SlideError(
      "PDF_MISSING",
      mt("slides.sofficeNoPdf"),
    );
  }
  return pdf;
}

/** Legacy binary .ppt/.pps carry no OOXML we can read, but LibreOffice
 *  preserves their transition timings through a round-trip to .pptx — this is
 *  what recovers auto-advance and embedded audio for the old decks churches
 *  actually have on file. */
export async function convertToPptx(options: ConvertOptions): Promise<string> {
  const info = await requireSoffice();
  const abs = assertSafeSourcePath(options.sourcePath);

  await runSoffice({
    info,
    args: [
      ...baseArgs(),
      "--convert-to",
      // No quotes around the filter name: these are argv entries, not a shell
      // string, so literal quote characters would be part of the filter name
      // and LibreOffice would reject it.
      "pptx:Impress MS PowerPoint 2007 XML",
      "--outdir",
      options.outDir,
      abs,
    ],
    timeoutMs: options.timeoutMs,
    ...(options.signal ? { signal: options.signal } : {}),
  });

  const pptx = findOutput(options.outDir, ".pptx");
  if (!pptx) throw new SlideError("PDF_MISSING", mt("slides.pptUpgradeFailed"));
  return pptx;
}

/**
 * A fresh UserInstallation costs several seconds of bootstrap on its first
 * real use. Paying that once at startup keeps it out of the operator's way
 * mid-service. Guarded per LibreOffice version by a setting.
 */
export async function warmProfile(): Promise<void> {
  const status = await locateSoffice();
  if (!status.available) return;

  const settings = getSettingsRepo();
  if (settings.get("slides.profileWarmedVersion") === status.info.version) return;

  try {
    await runSoffice({
      info: status.info,
      args: [...baseArgs(), "--terminate_after_init"],
      timeoutMs: 60_000,
    });
    settings.setMany({ "slides.profileWarmedVersion": status.info.version });
  } catch {
    // Best-effort: a failed warm-up must never block anything.
  }
}

/** Nukes a corrupted profile (e.g. a stale .~lock from a process we killed).
 *  Called after repeated timeouts.
 *
 *  Recreated immediately rather than left for the next startup's `mkdirSync`:
 *  the whole point of resetting is that the very next conversion should work,
 *  and that conversion happens in this run, not the next one. */
export function resetSofficeProfile(): void {
  try {
    fs.rmSync(sofficeProfileDir, { recursive: true, force: true });
    fs.mkdirSync(sofficeProfileDir, { recursive: true });
  } catch {
    /* best-effort */
  }
  getSettingsRepo().setMany({ "slides.profileWarmedVersion": null });
}
