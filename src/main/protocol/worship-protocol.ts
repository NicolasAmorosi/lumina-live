import { net, protocol } from "electron";
import { pathToFileURL } from "node:url";
import fs from "node:fs";
import path from "node:path";
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

async function serveFile(
  filePath: string | null,
  extraHeaders?: Record<string, string>,
): Promise<Response> {
  if (!filePath) return new Response("Not found", { status: 404 });
  if (!fs.existsSync(filePath)) return new Response("Gone", { status: 410 });

  const response = await net.fetch(pathToFileURL(filePath).href, {
    bypassCustomProtocolHandlers: true,
  });
  if (!extraHeaders) return response;

  const merged = new Headers(response.headers);
  for (const [key, value] of Object.entries(extraHeaders)) merged.set(key, value);
  return new Response(response.body, { status: response.status, headers: merged });
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
 * scheme + net.fetch's own Range handling is what lets `<video>` and `<audio>`
 * seek.
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
          return serveFile(mediaRepo.getPathById(id));
        }
        case "logo": {
          return serveFile(getSettingsRepo().get("logo.path"));
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
          return serveFile(filePath, {
            "Cache-Control": "public, max-age=31536000, immutable",
          });
        }
        case "deck-audio": {
          const audioId = Number(segments[0]);
          if (!Number.isFinite(audioId)) return new Response("Not found", { status: 404 });
          // No immutable header: the raw net.fetch response keeps Range/seek.
          return serveFile(withinCache(getSlidesRepo().getAudioPath(audioId)));
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
          return serveFile(resolved);
        }
        default:
          return new Response("Not found", { status: 404 });
      }
    } catch {
      return new Response("Internal error", { status: 500 });
    }
  });
}
