import { net, protocol } from "electron";
import { pathToFileURL } from "node:url";
import fs from "node:fs";
import type { MediaRepo } from "../db/repositories/media.repo";
import { getSettingsRepo } from "../services/repos";

/** In-memory map of ephemeral PPT slide export sessions: sessionId -> ordered slide paths. */
const slideSessions = new Map<string, string[]>();

export function registerSlideSession(sessionId: string, paths: string[]): void {
  slideSessions.set(sessionId, paths);
}

export function clearSlideSessions(): void {
  slideSessions.clear();
}

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

async function serveFile(filePath: string | null): Promise<Response> {
  if (!filePath) return new Response("Not found", { status: 404 });
  if (!fs.existsSync(filePath)) return new Response("Gone", { status: 410 });
  return net.fetch(pathToFileURL(filePath).href, { bypassCustomProtocolHandlers: true });
}

/**
 * Serves local files by CAPABILITY (a DB id or a session id), never by raw
 * filesystem path — the URL can never path-traverse, and relocating a file in
 * the library keeps the exact same `worship://asset/<id>` URL, so React never
 * needs to remount a player because a path changed. `stream: true` on the
 * scheme + net.fetch's own Range handling is what lets `<video>` seek.
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
        case "slide": {
          const [sessionId, fileName] = segments;
          const paths = slideSessions.get(sessionId ?? "");
          const index = Number((fileName ?? "").replace(/\D/g, "")) - 1;
          return serveFile(paths?.[index] ?? null);
        }
        default:
          return new Response("Not found", { status: 404 });
      }
    } catch {
      return new Response("Internal error", { status: 500 });
    }
  });
}
