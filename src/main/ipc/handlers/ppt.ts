import fs from "node:fs";
import path from "node:path";
import type { Handlers } from "../register";
import { getMediaRepo } from "../../services/repos";
import * as com from "../../powerpoint/com";
import { registerSlideSession, clearSlideSessions } from "../../protocol/worship-protocol";
import { slideUrl } from "@shared/urls";

let activeSlideCount = 0;

/**
 * Slide export is expensive (COM round-trip, ~30s worst case) so re-opening the
 * same, unchanged PPT within a session reuses the cached PNGs instead of
 * re-exporting — this is the fix for the legacy bug where
 * `os.tmpdir()/worship_slides_<ts>/` accumulated forever and every open paid
 * the full export cost again.
 */
function cacheKey(filePath: string, mtimeMs: number) {
  return `${filePath}::${mtimeMs}`;
}
const sessionByFile = new Map<string, { sessionId: string; paths: string[] }>();

export const pptHandlers: Pick<
  Handlers,
  "ppt:open" | "ppt:next" | "ppt:prev" | "ppt:goto" | "ppt:currentSlide" | "ppt:close" | "ppt:exportSlides"
> = {
  "ppt:open": async ({ assetId }) => {
    const filePath = getMediaRepo().getPathById(assetId);
    if (!filePath) throw new Error("PPT asset not found");
    const result = await com.openPresentation(filePath);
    activeSlideCount = result.totalSlides;
    return result;
  },

  "ppt:next": async () => {
    await com.nextSlide();
  },
  "ppt:prev": async () => {
    await com.prevSlide();
  },
  "ppt:goto": async ({ slide }) => {
    await com.gotoSlide(slide);
  },
  "ppt:currentSlide": () => com.getCurrentSlide(),

  "ppt:close": async () => {
    await com.closePresentation();
    activeSlideCount = 0;
  },

  "ppt:exportSlides": async ({ assetId }) => {
    const filePath = getMediaRepo().getPathById(assetId);
    if (!filePath) throw new Error("PPT asset not found");
    const stat = fs.statSync(filePath);
    const key = cacheKey(filePath, Math.trunc(stat.mtimeMs));

    const cached = sessionByFile.get(key);
    if (cached && cached.paths.every((p) => fs.existsSync(p))) {
      return {
        sessionId: cached.sessionId,
        urls: cached.paths.map((_, i) => slideUrl(cached.sessionId, i + 1)),
      };
    }

    const { sessionId, imagePaths } = await com.exportSlides(filePath);
    registerSlideSession(sessionId, imagePaths);
    sessionByFile.set(key, { sessionId, paths: imagePaths });
    return { sessionId, urls: imagePaths.map((_, i) => slideUrl(sessionId, i + 1)) };
  },
};

/** Deletes exported slide temp directories that are no longer cached — called
 *  on app quit so tmpdir doesn't grow unbounded across sessions. */
export function cleanupSlideTempDirs(): void {
  clearSlideSessions();
  for (const { paths } of sessionByFile.values()) {
    const dir = paths[0] ? path.dirname(paths[0]) : null;
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
  sessionByFile.clear();
}

export function getActiveSlideCount(): number {
  return activeSlideCount;
}
