import { execFile, spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { SOFFICE_PROBE_TIMEOUT_MS } from "@shared/constants";
import { sofficeProfileDir } from "../paths";
import { getSettingsRepo } from "../services/repos";
import { SlideError } from "./errors";

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

export async function probeVersion(
  exe: string,
): Promise<{ version: string; major: number } | null> {
  return new Promise((resolve) => {
    execFile(
      exe,
      ["--version"],
      { timeout: SOFFICE_PROBE_TIMEOUT_MS, windowsHide: true },
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
      message:
        "La versión de LibreOffice instalada (flatpak/snap) está aislada del sistema de archivos y no puede convertir presentaciones. Instalá el paquete nativo (.deb/.rpm).",
      checkedPaths: [exe],
      overridePath: null,
    };
  }
  const probed = await probeVersion(exe);
  if (!probed) {
    return {
      available: false,
      reason: "probe-failed",
      message: `Se encontró LibreOffice en ${exe} pero no respondió a --version.`,
      checkedPaths: [exe],
      overridePath: null,
    };
  }
  return {
    available: true,
    info: { path: exe, version: probed.version, major: probed.major, source, flavor },
  };
}

export async function locateSoffice(opts?: { force?: boolean }): Promise<SofficeStatus> {
  if (cached && !opts?.force) return cached;

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
          message: `La ruta configurada para LibreOffice no es ejecutable: ${override}`,
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
  }

  cached = {
    available: false,
    reason: "not-found",
    message: "No se encontró LibreOffice en este sistema.",
    checkedPaths: checked,
    overridePath: null,
  };
  return cached;
}

export async function requireSoffice(): Promise<SofficeInfo> {
  const status = await locateSoffice();
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

/** Kills the whole process group: soffice.com/soffice delegates to soffice.bin,
 *  so killing only the direct child orphans the real worker. */
function killTree(child: ChildProcess): void {
  if (child.pid === undefined) return;
  if (process.platform === "win32") {
    execFile("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true }, () => {});
    return;
  }
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    try {
      child.kill("SIGTERM");
    } catch {
      /* already gone */
    }
  }
  setTimeout(() => {
    if (child.pid === undefined || child.exitCode !== null) return;
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      /* already gone */
    }
  }, 5000).unref();
}

/** Safe to call synchronously from `before-quit`. */
export function killRunningSoffice(): void {
  if (running) killTree(running);
  running = null;
}

type RunOptions = {
  info: SofficeInfo;
  args: string[];
  timeoutMs: number;
  signal?: AbortSignal;
};

function runSoffice({ info, args, timeoutMs, signal }: RunOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new SlideError("CANCELED", "Conversión cancelada."));
      return;
    }

    const child = spawn(info.path, args, {
      windowsHide: true,
      // Own process group so killTree can take down soffice.bin with it.
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        // OpenCL in headless mode on a flaky GPU driver is a known hang source.
        SAL_DISABLE_OPENCL: "1",
      },
    });
    running = child;

    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
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
            `LibreOffice no respondió en ${Math.round(timeoutMs / 1000)}s. Si lo tenés abierto, cerralo y probá de nuevo.`,
          ),
        ),
      );
    }, timeoutMs);

    const onAbort = () => {
      killTree(child);
      finish(() => reject(new SlideError("CANCELED", "Conversión cancelada.")));
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
              `LibreOffice terminó con código ${code}. ${stderr.trim()}`.trim(),
            ),
          );
      });
    });
  });
}

function baseArgs(): string[] {
  return [
    "--headless",
    "--invisible",
    "--nologo",
    "--nodefault",
    "--norestore",
    "--nolockcheck",
    // A dedicated UserInstallation gets its own lock file and named pipe, which
    // is what makes us immune to a copy of LibreOffice the user has open as a
    // normal GUI app (the classic "conversion silently does nothing" failure).
    `-env:UserInstallation=${pathToFileURL(sofficeProfileDir).href}`,
  ];
}

/** Arguments always travel as an argv array (never a shell string), so quoting
 *  can't be exploited. The one real hazard is argument confusion — a file named
 *  `-env:foo` would parse as an option — which resolving to an absolute path
 *  rules out. */
function assertSafeSourcePath(sourcePath: string): string {
  const abs = path.resolve(sourcePath);
  if (!path.isAbsolute(abs)) {
    throw new SlideError("SOURCE_MISSING", `Ruta de origen inválida: ${sourcePath}`);
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

export type ConvertOptions = {
  sourcePath: string;
  outDir: string;
  timeoutMs: number;
  signal?: AbortSignal;
};

export async function convertToPdf(options: ConvertOptions): Promise<string> {
  const info = await requireSoffice();
  const abs = assertSafeSourcePath(options.sourcePath);

  // Name the Impress filter explicitly so a .ppsx can't get routed through
  // Writer's or Draw's PDF export.
  const filter =
    info.major >= 8 || info.major >= 7
      ? 'pdf:impress_pdf_Export:{"ReduceImageResolution":{"type":"boolean","value":"false"},"Quality":{"type":"long","value":"100"}}'
      : "pdf:impress_pdf_Export";

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
      "LibreOffice terminó sin generar un PDF. El archivo puede estar dañado o protegido.",
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
  if (!pptx) throw new SlideError("PDF_MISSING", "No se pudo convertir el .ppt a .pptx.");
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
 *  Called after repeated timeouts. */
export function resetSofficeProfile(): void {
  try {
    fs.rmSync(sofficeProfileDir, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
  getSettingsRepo().setMany({ "slides.profileWarmedVersion": null });
}
