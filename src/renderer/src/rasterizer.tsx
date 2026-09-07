// The LEGACY build, deliberately: pdf.js's modern bundle uses JS built-ins
// (e.g. Uint8Array.prototype.toHex) that Electron 36's Chromium doesn't have
// yet, and it fails at runtime with an unhelpful "n.toHex is not a function".
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import pdfWorkerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";

/**
 * Offscreen slide rasterizer. This window has no UI and no domain logic: main
 * hands it a `worship://raster/<jobId>` URL, it renders every PDF page to a
 * canvas at the requested width and hands the encoded bytes back one page at a
 * time. Main does all the file writing.
 *
 * It lives in the renderer (not a Node worker) because rasterizing needs a real
 * Canvas2D and Chromium already has one — see src/main/slides/rasterizer.ts for
 * why the native-canvas alternative was rejected.
 */
pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

type StartMessage = {
  jobId: string;
  url: string;
  targetWidth: number;
  thumbWidth: number;
  format: "webp" | "png";
  quality: number;
};

const MIN_SCALE = 0.5;
const MAX_SCALE = 4;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

async function encode(
  canvas: HTMLCanvasElement,
  format: "webp" | "png",
  quality: number,
): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, `image/${format}`, quality),
  );
  if (!blob) throw new Error("No se pudo codificar la imagen de la diapositiva");
  return new Uint8Array(await blob.arrayBuffer());
}

function drawScaled(source: HTMLCanvasElement, targetWidth: number): HTMLCanvasElement {
  const ratio = targetWidth / source.width;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(source.width * ratio));
  canvas.height = Math.max(1, Math.round(source.height * ratio));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No se pudo crear el contexto 2D de la miniatura");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

async function run(message: StartMessage): Promise<void> {
  const { jobId, url, targetWidth, thumbWidth, format, quality } = message;

  const response = await fetch(url);
  if (!response.ok) throw new Error(`No se pudo leer el PDF (${response.status})`);
  const data = new Uint8Array(await response.arrayBuffer());

  const loadingTask = pdfjs.getDocument({
    data,
    // LibreOffice embeds/subsets every font into the PDF, so pdf.js should
    // never reach for a system font here.
    useSystemFonts: false,
  });
  const doc = await loadingTask.promise;

  try {
    const total = doc.numPages;

    for (let index = 1; index <= total; index += 1) {
      const page = await doc.getPage(index);
      try {
        const baseViewport = page.getViewport({ scale: 1 });
        const scale = clamp(targetWidth / baseViewport.width, MIN_SCALE, MAX_SCALE);
        const viewport = page.getViewport({ scale });

        const canvas = document.createElement("canvas");
        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("No se pudo crear el contexto 2D");

        await page.render({ canvas, canvasContext: ctx, viewport }).promise;

        const full = await encode(canvas, format, quality);
        const thumb = await encode(drawScaled(canvas, thumbWidth), format, 0.7);

        await window.worship.invoke("raster:page", {
          jobId,
          index,
          total,
          widthPx: canvas.width,
          heightPx: canvas.height,
          data: full,
          thumbData: thumb,
        });
      } finally {
        // pdf.js leaks aggressively without this on long documents.
        page.cleanup();
      }
    }

    await window.worship.invoke("raster:done", { jobId, total });
  } finally {
    // Releases the worker and every page's resources; pdf.js leaks
    // aggressively on long documents otherwise.
    await loadingTask.destroy();
  }
}

window.worship.on("raster:start", (payload) => {
  const message = payload as StartMessage;
  void run(message).catch(async (error: unknown) => {
    await window.worship.invoke("raster:error", {
      jobId: message.jobId,
      message: error instanceof Error ? error.message : String(error),
    });
  });
});
