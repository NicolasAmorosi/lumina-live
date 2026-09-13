import { app, BrowserWindow, ipcMain } from "electron";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { SLIDES_RASTER_PAGE_TIMEOUT_MS, SLIDES_THUMB_WIDTH } from "@shared/constants";
import { SlideError } from "./errors";
import { trustWindow } from "../ipc/trusted-senders";

const PRELOAD = path.join(__dirname, "../preload/index.js");
const IDLE_SHUTDOWN_MS = 60_000;

export type RasterPage = {
  index: number;
  file: string;
  thumbFile: string;
  widthPx: number;
  heightPx: number;
  /** The full-size image's bytes as written. */
  bytes: number;
  /** The thumbnail's, so the caller can total a deck's on-disk size without
   *  walking the directory back — see `dirSize`'s removal in `deck-service`. */
  thumbBytes: number;
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

  trustWindow(win);

  win.on("closed", () => {
    if (window === win) window = null;
  });

  // Subscribed and awaited INSIDE a try: a rejected load (dev server not up
  // yet, a missing bundled file) used to throw out of here before `window =
  // win`, leaving a live, unreferenced, never-destroyed BrowserWindow behind —
  // which also kept `BrowserWindow.getAllWindows()` non-empty forever, and
  // that count is what `app.on("activate")`/`window-all-closed` read.
  try {
    const devServerUrl = process.env["ELECTRON_RENDERER_URL"];
    if (!app.isPackaged && devServerUrl) {
      await win.loadURL(`${devServerUrl}/rasterizer.html`);
    } else {
      await win.loadFile(path.join(__dirname, "../renderer/rasterizer.html"));
    }
  } catch (error) {
    if (!win.isDestroyed()) win.destroy();
    throw error;
  }

  window = win;
  return win;
}

/** Whether `win` is the offscreen rasterizer.
 *
 *  Needed because it is a real `BrowserWindow` and therefore shows up in
 *  `BrowserWindow.getAllWindows()` — which is what decides whether macOS
 *  reopens the control window on a dock click and whether
 *  `window-all-closed` fires at all. Counting an invisible worker as "the app
 *  still has a window" is wrong in both directions. */
export function isRasterizerWindow(win: BrowserWindow): boolean {
  return window === win;
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

  let win: BrowserWindow;
  try {
    win = await ensureWindow();
  } catch (error) {
    // The capability token is only cleared by `finish()`, which this job never
    // reaches if the window can't even be created.
    pendingPdfs.delete(jobId);
    throw error;
  }
  // Captured once: after a crash, reading `win.webContents` can throw on a
  // destroyed window, and the cleanup below still needs the object it
  // subscribed to.
  const contents = win.webContents;
  if (idleTimer) clearTimeout(idleTimer);

  const pages: RasterPage[] = [];
  const ext = request.format;

  return new Promise<RasterPage[]>((resolve, reject) => {
    let settled = false;
    let pageTimer: NodeJS.Timeout | null = null;

    // A renderer crash (OOM on a huge PDF) must reject rather than hang.
    // Declared before `finish` so that one can unsubscribe it; it only calls
    // `finish` when the event actually fires, long after setup.
    const onRenderProcessGone = () => {
      window = null;
      // Destroyed, not just dereferenced: a window whose renderer died stays
      // a live BrowserWindow (it counts in `getAllWindows()`, it holds its OS
      // resources), and the next conversion creates another one. Repeated
      // crashes — an OOM on a big PDF is the realistic case — would pile them
      // up with nothing ever reclaiming them.
      if (!win.isDestroyed()) win.destroy();
      finish(() =>
        reject(
          new SlideError("RASTER_FAILED", "El proceso de rasterizado se cerró inesperadamente."),
        ),
      );
    };

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      if (pageTimer) clearTimeout(pageTimer);
      jobs.delete(jobId);
      pendingPdfs.delete(jobId);
      request.signal?.removeEventListener("abort", onAbort);
      // The rasterizer window outlives a single job (it is reused until 60s
      // idle, which during a batch never happens), so a listener left behind
      // here accumulates one per converted deck: `once` only removes itself
      // when the event fires. That surfaced as
      // `MaxListenersExceededWarning: 11 render-process-gone listeners added
      // to [WebContents]` partway through a folder batch, with every stale
      // closure still holding its job's `pages`/`request`.
      if (!contents.isDestroyed()) contents.off("render-process-gone", onRenderProcessGone);
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
        // The index reaches us over IPC and is interpolated into a file name.
        // `pad` is `String(n).padStart(4,"0")`, which happily passes
        // `"../../x"` straight through to `path.join` — so this is the one
        // place in main where a renderer's value could steer where bytes get
        // written. Validated rather than trusted, even though the only sender
        // today is our own sandboxed rasterizer page.
        if (!Number.isSafeInteger(payload.index) || payload.index < 1) return;
        const file = `s${pad(payload.index)}.${ext}`;
        const thumbFile = `t${pad(payload.index)}.${ext}`;
        const buf = Buffer.from(payload.data);
        const thumbBuf = Buffer.from(payload.thumbData);
        fs.writeFileSync(path.join(request.outDir, file), buf);
        fs.writeFileSync(path.join(request.outDir, thumbFile), thumbBuf);

        const page: RasterPage = {
          index: payload.index,
          file,
          thumbFile,
          widthPx: payload.widthPx,
          heightPx: payload.heightPx,
          bytes: buf.byteLength,
          thumbBytes: thumbBuf.byteLength,
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

    contents.once("render-process-gone", onRenderProcessGone);

    armPageTimer();
    contents.send("raster:start", {
      jobId,
      url: `worship://raster/${jobId}`,
      targetWidth: request.targetWidth,
      thumbWidth: SLIDES_THUMB_WIDTH,
      format: request.format,
      quality: request.quality,
    });
  });
}
