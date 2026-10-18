import fs from "node:fs";
import path from "node:path";
import type { MediaAsset, MediaConversionUpdate } from "../../src/shared/types/media";
import { fixture } from "./support/paths";
import { audioStates, expect, relaunch, test, videoStates, type WorshipApp } from "./support/app";

/**
 * "Tiene que poder reproducir todo lo que le tires" (2026-10-18). Each file
 * here is one Chromium cannot play as it is — measured, not assumed; see
 * `src/main/media/media-compat.ts` — and each must end up playing on the
 * projector anyway, without the operator doing anything but importing it.
 */

const conversions = (app: WorshipApp) => app.invoke<MediaConversionUpdate[]>("conversion:list");
/** Assets that cannot play yet. A converted one stays listed, with its copy's
 *  `version` and no state. */
const pending = async (app: WorshipApp) => (await conversions(app)).filter((c) => c.state !== null);

/** Main logs `[convert] <source> → <output> in N s` once a copy is in place
 *  (`conversion-service.ts`). The list alone cannot say it: an asset that was
 *  not queued YET is absent from it too. */
const convertedLines = (app: WorshipApp, asset: MediaAsset) =>
  app.log.filter((line) => line.includes("[convert]") && line.includes(`${asset.path} →`));

async function waitConverted(app: WorshipApp, asset: MediaAsset) {
  await expect.poll(() => convertedLines(app, asset).length, { timeout: 90_000 }).toBe(1);
  // Playable now, through its copy.
  const entry = (await conversions(app)).find((c) => c.assetId === asset.id);
  expect(entry?.state ?? null).toBeNull();
  expect(entry?.version).toBeTruthy();
}

test("an AVI converts on its own, is refused live while it does, and then projects", async ({ app }) => {
  const [avi] = await app.addMedia("video", "long-xvid.avi");
  if (!avi) throw new Error("import failed");
  await app.previewFile("Videos", "long-xvid");

  // PREVIEW says what is happening instead of mounting a player that would
  // fail to open the file.
  await expect(app.control.getByText(/En cola para convertir|Convirtiendo…/)).toBeVisible();
  await app.goLive();
  await expect(app.control.getByText("«long-xvid» todavía se está convirtiendo", { exact: false })).toBeVisible();
  // Refused before anything happened: no projector was even opened.
  expect(app.hasProjector()).toBe(false);

  await waitConverted(app, avi);
  // PREVIEW now mounts the converted copy itself.
  await expect
    .poll(async () =>
      (await videoStates(app.control)).some((v) => new RegExp(`/asset/${avi.id}(\\?|$)`).test(v.src) && v.readyState >= 1),
    )
    .toBe(true);

  await app.goLive();
  const projector = await app.projector();
  await expect.poll(async () => (await videoStates(projector))[0]?.currentTime ?? 0).toBeGreaterThan(0.5);
  expect((await videoStates(projector))[0]).toMatchObject({ paused: false, videoWidth: 1920 });
});

test("an MP4 that played sound over a black picture now shows its picture", async ({ app }) => {
  const [mp4] = await app.addMedia("video", "sound-over-black.mp4");
  if (!mp4) throw new Error("import failed");
  await waitConverted(app, mp4);
  await app.previewFile("Videos", "sound-over-black");
  await app.goLive();
  const projector = await app.projector();
  await expect.poll(async () => (await videoStates(projector))[0]?.videoWidth ?? 0).toBe(640);
  await expect.poll(async () => (await videoStates(projector))[0]?.currentTime ?? 0).toBeGreaterThan(0.5);
});

test("a WMA converts and plays", async ({ app }) => {
  const [wma] = await app.addMedia("audio", "song.wma");
  if (!wma) throw new Error("import failed");
  await waitConverted(app, wma);
  await app.previewFile("Audios", "song");
  await app.goLive();
  const projector = await app.projector();
  await expect.poll(async () => (await audioStates(projector))[0]?.currentTime ?? 0).toBeGreaterThan(0.5);
});

test("a file that already plays is never converted", async ({ app }) => {
  await app.addMedia("video", "clip.mp4");
  await app.addMedia("audio", "song.mp3");
  // Give the background check time to probe both.
  await app.control.waitForTimeout(3000);
  // Not pending, and no copy either: these play as they are.
  expect(await conversions(app)).toEqual([]);
  expect(app.log.filter((line) => line.includes("[convert]") && line.includes("→"))).toEqual([]);
  const dir = path.join(app.profile, "converted-media");
  expect(fs.existsSync(dir) ? fs.readdirSync(dir) : []).toEqual([]);
});

test("a conversion is done once and survives a restart", async ({ app }) => {
  const [avi] = await app.addMedia("video", "clip-xvid.avi");
  if (!avi) throw new Error("import failed");
  await waitConverted(app, avi);
  // On a PC with no console, main's own log is the only record of it.
  expect(fs.readFileSync(path.join(app.profile, "main.log"), "utf8")).toContain(`${avi.path} →`);
  await app.quit();

  const again = await relaunch(app);
  await again.control.waitForTimeout(3000);
  expect(await pending(again)).toEqual([]);
  expect((await conversions(again)).find((c) => c.assetId === avi.id)?.version).toBeTruthy();
  // Not converted a second time.
  expect(again.log.filter((line) => line.includes("[convert]") && line.includes("→"))).toEqual([]);
  await again.previewFile("Videos", "clip-xvid");
  await again.goLive();
  const projector = await again.projector();
  await expect.poll(async () => (await videoStates(projector))[0]?.videoWidth ?? 0).toBe(640);
});

test("a video replaced in place is probed again, never served from the old file's copy", async ({ app }) => {
  // Last week's announcements needed converting…
  const file = path.join(app.profile, "media-src", "anuncios.mp4");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.copyFileSync(fixture("sound-over-black.mp4"), file);
  const [asset] = await app.invoke<MediaAsset[]>("library:add", { kind: "video", paths: [file] });
  if (!asset) throw new Error("import failed");
  await waitConverted(app, asset);
  await app.quit();

  // …and this week's, saved over the same file, plays as it is and is longer.
  fs.copyFileSync(fixture("clip.mp4"), file);
  const again = await relaunch(app);
  // The launch sweep notices the edit and re-probes: the old copy is dropped,
  // and this file needs none.
  await expect.poll(async () => (await conversions(again)).some((c) => c.assetId === asset.id), { timeout: 20_000 }).toBe(false);
  await again.previewFile("Videos", "anuncios");
  await again.goLive();
  const projector = await again.projector();
  await expect
    .poll(() => projector.evaluate(() => document.querySelector("video")?.duration ?? 0), { timeout: 30_000 })
    .toBeCloseTo(8, 0);
});
