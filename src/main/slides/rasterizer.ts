import { app, BrowserWindow, ipcMain } from "electron";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { SLIDES_RASTER_PAGE_TIMEOUT_MS, SLIDES_THUMB_WIDTH } from "@shared/constants";
import { SlideError } from "./errors";

const PRELOAD = path.join(__dirname, "../preload/index.js");
const IDLE_SHUTDOWN_MS = 60_000;

export type RasterPage = {
  index: number;
  file: string;
  thumbFile: string;
  widthPx: number;
  heightPx: number;
  bytes: number;
};

export type RasterRequest = {
  pdfPath: string;
  outDir: string;
  targetWidth: number;
  format: "webp" | "png";
  quality: number;
  signal?: AbortSignal;
  onPage?: (page: RasterPage, total: number) => void;
};

/**
 * In-flight PDFs, exposed to the sandboxed rasterizer window as
 * `worship://raster/<jobId>`. The window has no filesystem access (sandbox:
 * true, contextIsolation: true), and this keeps that intact: it receives a
 * capability token, never a path.
 */
const pendingPdfs = new Map<string, string>();

export function resolveRasterPdf(jobId: string): string | null {
  return pendingPdfs.get(jobId) ?? null;
}

/**
 * Rasterization runs in a hidden BrowserWindow rather than a Node worker: it
 * needs a real Canvas2D implementation and Chromium already ships one. The
 * alternative (@napi-rs/canvas in a utilityProcess) publishes its prebuilt
 * binary as a PER-PLATFORM optionalDependency, so `npm install` on macOS never
 * fetches the Windows one and cross-building the Windows installer from a Mac
 * — which this project does — would silently ship a broken app. A hidden
 * window is already its own OS process, so crash isolation is equivalent.
 */
let window: BrowserWindow | null = null;
let idleTimer: NodeJS.Timeout | null = null;

function scheduleIdleShutdown(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(shutdownRasterizer, IDLE_SHUTDOWN_MS);
  idleTimer.unref();
}

async function ensureWindow(): Promise<BrowserWindow> {
  if (window && !window.isDestroyed()) return window;

  const win = new BrowserWindow({
    show: false,
    width: 100,
    height: 100,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      // Hidden windows are throttled by default, which would stall rendering.
      backgroundThrottling: false,
    },
  });

  const devServerUrl = process.env["ELECTRON_RENDERER_URL"];
  if (!app.isPackaged && devServerUrl) {
    await win.loadURL(`${devServerUrl}/rasterizer.html`);
  } else {
    await win.loadFile(path.join(__dirname, "../renderer/rasterizer.html"));
  }

  win.on("closed", () => {
    if (window === win) window = null;
  });

  window = win;
  return win;
}

export function shutdownRasterizer(): void {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  if (window && !window.isDestroyed()) window.destroy();
  window = null;
}

function pad(n: number): string {
  return String(n).padStart(4, "0");
}

type PagePayload = {
  jobId: string;
  index: number;
  total: number;
  widthPx: number;
  heightPx: number;
  data: Uint8Array;
  thumbData: Uint8Array;
};

type DonePayload = { jobId: string; total: number };
type ErrorPayload = { jobId: string; message: string };

type JobHandlers = {
  onPage: (payload: PagePayload) => void;
  onDone: (payload: DonePayload) => void;
  onError: (payload: ErrorPayload) => void;
};

const jobs = new Map<string, JobHandlers>();
let channelsRegistered = false;

/** One set of handlers for every job; the jobId in the payload routes it. */
function registerChannels(): void {
  if (channelsRegistered) return;
  channelsRegistered = true;
  ipcMain.handle("raster:page", (_event, payload: PagePayload) => {
    jobs.get(payload.jobId)?.onPage(payload);
  });
  ipcMain.handle("raster:done", (_event, payload: DonePayload) => {
    jobs.get(payload.jobId)?.onDone(payload);
  });
  ipcMain.handle("raster:error", (_event, payload: ErrorPayload) => {
    jobs.get(payload.jobId)?.onError(payload);
  });
}

/**
 * Renders every page of `pdfPath` into `outDir` as `s0001.<ext>` plus a
 * `t0001.<ext>` thumbnail. Pages stream back one at a time and are written to
 * disk here, so memory stays flat even on a 400-slide deck.
 */
export async function rasterizePdf(request: RasterRequest): Promise<RasterPage[]> {
  registerChannels();

  const jobId = randomUUID();
  pendingPdfs.set(jobId, request.pdfPath);
  fs.mkdirSync(request.outDir, { recursive: true });

  const win = await ensureWindow();
  if (idleTimer) clearTimeout(idleTimer);

  const pages: RasterPage[] = [];
  const ext = request.format;

  return new Promise<RasterPage[]>((resolve, reject) => {
    let settled = false;
    let pageTimer: NodeJS.Timeout | null = null;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      if (pageTimer) clearTimeout(pageTimer);
      jobs.delete(jobId);
      pendingPdfs.delete(jobId);
      request.signal?.removeEventListener("abort", onAbort);
      scheduleIdleShutdown();
      fn();
    };

    const armPageTimer = () => {
      if (pageTimer) clearTimeout(pageTimer);
      pageTimer = setTimeout(() => {
        finish(() =>
          reject(new SlideError("RASTER_FAILED", "El rasterizado de una página se colgó.")),
        );
      }, SLIDES_RASTER_PAGE_TIMEOUT_MS);
    };

    const onAbort = () => finish(() => reject(new SlideError("CANCELED", "Conversión cancelada.")));

    jobs.set(jobId, {
      onPage: (payload) => {
        armPageTimer();
        const file = `s${pad(payload.index)}.${ext}`;
        const thumbFile = `t${pad(payload.index)}.${ext}`;
        const buf = Buffer.from(payload.data);
        fs.writeFileSync(path.join(request.outDir, file), buf);
        fs.writeFileSync(path.join(request.outDir, thumbFile), Buffer.from(payload.thumbData));

        const page: RasterPage = {
          index: payload.index,
          file,
          thumbFile,
          widthPx: payload.widthPx,
          heightPx: payload.heightPx,
          bytes: buf.byteLength,
        };
        pages.push(page);
        request.onPage?.(page, payload.total);
      },
      onDone: () => finish(() => resolve(pages.sort((a, b) => a.index - b.index))),
      onError: (payload) =>
        finish(() => reject(new SlideError("RASTER_FAILED", payload.message))),
    });

    request.signal?.addEventListener("abort", onAbort, { once: true });
    if (request.signal?.aborted) {
      onAbort();
      return;
    }

    // A renderer crash (OOM on a huge PDF) must reject rather than hang.
    win.webContents.once("render-process-gone", () => {
      window = null;
      finish(() =>
        reject(
          new SlideError("RASTER_FAILED", "El proceso de rasterizado se cerró inesperadamente."),
        ),
      );
    });

    armPageTimer();
    win.webContents.send("raster:start", {
      jobId,
      url: `worship://raster/${jobId}`,
      targetWidth: request.targetWidth,
      thumbWidth: SLIDES_THUMB_WIDTH,
      format: request.format,
      quality: request.quality,
    });
  });
}
