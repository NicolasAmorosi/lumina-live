import { audioStates, expect, test, videoStates } from "./support/app";

test("a video goes through PREVIEW before it reaches the projector", async ({ app }) => {
  const [clip] = await app.addMedia("video", "clip.mp4");
  await app.previewFile("Videos", "clip");

  // Selecting only previews: the projector does not even exist yet.
  await expect(app.control.getByRole("slider", { name: "Posición de clip" }).first()).toBeVisible();
  expect(app.hasProjector()).toBe(false);

  await app.goLive();
  const projector = await app.projector();
  await expect
    .poll(async () => (await videoStates(projector)).find((v) => v.src.endsWith(`/asset/${clip?.id}`))?.currentTime ?? 0)
    .toBeGreaterThan(0.5);
  const [video] = await videoStates(projector);
  expect(video).toMatchObject({ paused: false, videoWidth: 640 });
  // The LIVE panel offers to pause what is playing.
  await expect(app.control.getByRole("button", { name: "Pausar" })).toBeVisible();
});

test("NEGRO hides and pauses the video, and uncovering resumes where it was", async ({ app }) => {
  await app.addMedia("video", "clip.mp4");
  await app.previewFile("Videos", "clip");
  await app.goLive();
  const projector = await app.projector();
  await expect.poll(async () => (await videoStates(projector))[0]?.currentTime ?? 0).toBeGreaterThan(1);

  await app.control.getByRole("button", { name: "NEGRO" }).click();
  await expect.poll(async () => (await videoStates(projector))[0]).toMatchObject({ paused: true, opacity: 0 });
  const coveredAt = (await videoStates(projector))[0]?.currentTime ?? 0;
  await projector.waitForTimeout(1000);
  // Still mounted and still where it stopped: not restarted, not advancing.
  expect((await videoStates(projector))[0]?.currentTime).toBeCloseTo(coveredAt, 1);

  // B toggles it back, from the keyboard like an operator would.
  await app.control.locator("body").press("b");
  await expect.poll(async () => (await videoStates(projector))[0]).toMatchObject({ paused: false, opacity: 1 });
  expect((await videoStates(projector))[0]?.currentTime).toBeGreaterThanOrEqual(coveredAt);
});

test("an image is projected", async ({ app }) => {
  const [photo] = await app.addMedia("image", "photo.png");
  await app.previewFile("Imágenes", "photo");
  await app.goLive();
  const projector = await app.projector();
  const image = projector.locator(`img[src="worship://asset/${photo?.id}"]`);
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1280);
});

test("an audio plays without changing what is on screen", async ({ app }) => {
  const [clip] = await app.addMedia("video", "clip.mp4");
  await app.addMedia("audio", "song.mp3");
  await app.previewFile("Videos", "clip");
  await app.goLive();
  const projector = await app.projector();
  await expect.poll(async () => (await videoStates(projector))[0]?.currentTime ?? 0).toBeGreaterThan(0.3);

  await app.previewFile("Audios", "song");
  await app.goLive();
  await expect.poll(async () => (await audioStates(projector))[0]?.currentTime ?? 0).toBeGreaterThan(0.5);
  // The video is still the picture, and still playing.
  const [video] = await videoStates(projector);
  expect(video?.src).toContain(`/asset/${clip?.id}`);
  expect(video?.paused).toBe(false);
});

test("closing the projector window from outside does not strand the operator", async ({ app }) => {
  await app.addMedia("image", "photo.png");
  await app.previewFile("Imágenes", "photo");
  await app.goLive();
  const first = await app.projector();
  await first.close();
  await expect.poll(() => app.hasProjector()).toBe(false);

  // EN VIVO again reopens it, showing the same image.
  await app.goLive();
  const second = await app.projector();
  await expect(second.locator('img[src^="worship://asset/"]')).toBeVisible();
});
