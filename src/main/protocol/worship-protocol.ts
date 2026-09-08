import { protocol } from "electron";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import type { MediaRepo } from "../db/repositories/media.repo";
import { getSettingsRepo, getSlidesRepo } from "../services/repos";
import { slidesCacheDir, slidesTempDir } from "../paths";
import { resolveRasterPdf } from "../slides/rasterizer";

/** Must run before app.whenReady(). `standard: true` gives worship:// URLs a
 *  hostname + pathname like http, which is what the parsing below relies on. */
export function registerWorshipScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: "worship",
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        corsEnabled: true,
        bypassCSP: false,
      },
    },
  ]);
}

/** Explicit, because responses are now built by hand rather than by `net.fetch`
 *  (which sniffed the type but could not honour Range — see `serveFile`). A
 *  wrong/missing video MIME makes Chromium refuse the stream outright. */
const MIME_TYPES: Record<string, string> = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  mkv: "video/x-matroska",
  avi: "video/x-msvideo",
  webm: "video/webm",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  flac: "audio/flac",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  pdf: "application/pdf",
};

/** Undefined for an unrecognized extension, in which case the header is left
 *  off entirely and Chromium sniffs — asserting `application/octet-stream`
 *  would make it refuse to play an otherwise fine media file. Every extension
 *  the library accepts (`ASSET_EXTENSIONS`) is covered above. */
function contentTypeFor(filePath: string): string | undefined {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  return MIME_TYPES[ext];
}

/** `bytes=start-end`, `bytes=start-` and the suffix form `bytes=-lastN`.
 *  Returns null for an absent/unparseable header (serve the whole file) and
 *  "unsatisfiable" for a syntactically valid range outside the file. */
function parseRange(
  header: string | null,
  size: number,
): { start: number; end: number } | null | "unsatisfiable" {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, rawStart, rawEnd] = match;
  if (rawStart === "" && rawEnd === "") return null;

  // Suffix form: the last N bytes.
  if (rawStart === "") {
    const suffix = Number(rawEnd);
    if (!Number.isFinite(suffix) || suffix <= 0) return "unsatisfiable";
    const start = Math.max(0, size - suffix);
    return { start, end: size - 1 };
  }

  const start = Number(rawStart);
  if (!Number.isFinite(start) || start >= size) return "unsatisfiable";
  const end = rawEnd === "" ? size - 1 : Math.min(Number(rawEnd), size - 1);
  if (!Number.isFinite(end) || end < start) return "unsatisfiable";
  return { start, end };
}

function streamFile(filePath: string, range?: { start: number; end: number }): ReadableStream {
  const stream = range
    ? fs.createReadStream(filePath, { start: range.start, end: range.end })
    : fs.createReadStream(filePath);
  return Readable.toWeb(stream) as ReadableStream;
}

/**
 * Serves a local file with real HTTP range semantics.
 *
 * This used to delegate to `net.fetch(file://…)`, which silently ignored the
 * request's `Range` header and always answered 200 with the whole file. That is
 * what made `<video>`/`<audio>` report an EMPTY `seekable` range (so the
 * progress bar could never work), and — far worse — it made Chromium's media
 * pipeline read misaligned bytes whenever it re-requested at an offset (after
 * the element was recreated, or once its media cache held only part of a large
 * file). The decoder then got data that did not belong at the offset it asked
 * for and died with `kVTVideoDecoderBadDataErr` (-12909) — the video played for
 * about a second and froze for good, reliably by the third play of a large file.
 */
async function serveFile(
  request: Request,
  filePath: string | null,
  extraHeaders?: Record<string, string>,
): Promise<Response> {
  if (!filePath) return new Response("Not found", { status: 404 });

  let size: number;
  try {
    const stat = await fs.promises.stat(filePath);
    if (!stat.isFile()) return new Response("Gone", { status: 410 });
    size = stat.size;
  } catch {
    return new Response("Gone", { status: 410 });
  }

  const headers = new Headers({
    // Without this Chromium never even attempts a range request, and treats
    // the stream as unseekable.
    "Accept-Ranges": "bytes",
    ...extraHeaders,
  });
  const contentType = contentTypeFor(filePath);
  if (contentType) headers.set("Content-Type", contentType);

  const range = parseRange(request.headers.get("Range"), size);

  if (range === "unsatisfiable") {
    headers.set("Content-Range", `bytes */${size}`);
    return new Response(null, { status: 416, headers });
  }

  const wantsBody = request.method !== "HEAD";

  if (range) {
    const length = range.end - range.start + 1;
    headers.set("Content-Range", `bytes ${range.start}-${range.end}/${size}`);
    headers.set("Content-Length", String(length));
    return new Response(wantsBody ? streamFile(filePath, range) : null, { status: 206, headers });
  }

  headers.set("Content-Length", String(size));
  return new Response(wantsBody ? streamFile(filePath) : null, { status: 200, headers });
}

/** Defence in depth: these paths are already capability-derived (a DB row, not
 *  user input), so traversal isn't reachable — this asserts and documents that
 *  invariant at the point where bytes actually leave the process. */
function withinCache(filePath: string | null): string | null {
  if (!filePath) return null;
  const resolved = path.resolve(filePath);
  return resolved.startsWith(slidesCacheDir + path.sep) ? resolved : null;
}

/**
 * Serves local files by CAPABILITY (a DB id or a job id), never by raw
 * filesystem path — the URL can never path-traverse, and relocating a file in
 * the library keeps the exact same `worship://asset/<id>` URL, so React never
 * needs to remount a player because a path changed. `stream: true` on the
 * scheme plus `serveFile`'s own Range handling is what lets `<video>` and
 * `<audio>` seek.
 */
export function registerWorshipProtocolHandler(mediaRepo: MediaRepo): void {
  protocol.handle("worship", async (request) => {
    const url = new URL(request.url);
    const resource = url.hostname; // worship://asset/42 -> hostname "asset"
    const segments = url.pathname.split("/").filter(Boolean); // "/42" -> ["42"]

    try {
      switch (resource) {
        case "asset": {
          const id = Number(segments[0]);
          return serveFile(request, mediaRepo.getPathById(id));
        }
        case "logo": {
          return serveFile(request, getSettingsRepo().get("logo.path"));
        }
        case "deck": {
          // worship://deck/<deckId>/<slideIndex>[/thumb]
          const deckId = Number(segments[0]);
          const slideIndex = Number(segments[1]);
          if (!Number.isFinite(deckId) || !Number.isFinite(slideIndex)) {
            return new Response("Not found", { status: 404 });
          }
          const variant = segments[2] === "thumb" ? "thumb" : "full";
          const filePath = withinCache(
            getSlidesRepo().getSlideImagePath(deckId, slideIndex, variant),
          );
          // A (deckId, slideIndex) pair is immutable by construction: changing
          // the source file yields a different content hash and therefore a
          // different deck id. Without this header Chromium re-reads every
          // image on each <img> swap — during a live service.
          return serveFile(request, filePath, {
            "Cache-Control": "public, max-age=31536000, immutable",
          });
        }
        case "deck-audio": {
          const audioId = Number(segments[0]);
          if (!Number.isFinite(audioId)) return new Response("Not found", { status: 404 });
          // No immutable header: a soundtrack is seeked through, not swapped.
          return serveFile(request, withinCache(getSlidesRepo().getAudioPath(audioId)));
        }
        case "raster": {
          // Short-lived capability handed to the offscreen rasterizer window so
          // it can read the in-flight PDF without any filesystem access.
          const jobId = segments[0];
          const pdfPath = jobId ? resolveRasterPdf(jobId) : null;
          if (!pdfPath) return new Response("Not found", { status: 404 });
          const resolved = path.resolve(pdfPath);
          if (!resolved.startsWith(slidesTempDir + path.sep)) {
            return new Response("Forbidden", { status: 403 });
          }
          return serveFile(request, resolved);
        }
        default:
          return new Response("Not found", { status: 404 });
      }
    } catch {
      return new Response("Internal error", { status: 500 });
    }
  });
}
