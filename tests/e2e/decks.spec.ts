import fs from "node:fs";
import type { Page } from "@playwright/test";
import { fixture } from "./support/paths";
import { expect, test, videoStates, type WorshipApp } from "./support/app";

/** A rasterized slide in the centre grid, once the deck is converted. */
const slideTile = (app: WorshipApp, n: number) =>
  app.control.getByRole("list", { name: "Presentación" }).getByRole("button", { name: String(n), exact: true });

/** The slide the projector shows now: the topmost deck image. */
function projectedSlide(projector: Page): Promise<number | null> {
  return projector.evaluate(() => {
    const images = [...document.querySelectorAll<HTMLImageElement>('img[src^="worship://deck/"]')];
    const last = images.at(-1);
    const match = last ? /\/(\d+)$/.exec(last.src) : null;
    return match ? Number(match[1]) : null;
  });
}

test("a PDF is a deck: converted without LibreOffice, projected, stepped", async ({ app }) => {
  await app.addMedia("ppt", "deck.pdf");
  await app.previewFile("Presentaciones", "deck");
  // Its three pages, rasterized, in the centre grid.
  await expect(slideTile(app, 3)).toBeVisible({ timeout: 60_000 });

  await app.goLive();
  const projector = await app.projector();
  await expect.poll(() => projectedSlide(projector)).toBe(1);
  await app.control.keyboard.press("ArrowRight");
  await expect.poll(() => projectedSlide(projector)).toBe(2);
  await app.control.keyboard.press("ArrowLeft");
  await expect.poll(() => projectedSlide(projector)).toBe(1);
});

test("NEGRO over a deck, and the slide is still there underneath", async ({ app }) => {
  await app.addMedia("ppt", "deck.pdf");
  await app.previewFile("Presentaciones", "deck");
  await expect(slideTile(app, 3)).toBeVisible({ timeout: 60_000 });
  await app.goLive();
  const projector = await app.projector();
  await app.control.keyboard.press("ArrowRight");
  await expect.poll(() => projectedSlide(projector)).toBe(2);

  await app.control.keyboard.press("b");
  await expect.poll(() => projectedSlide(projector)).toBeNull();
  await app.control.keyboard.press("b");
  await expect.poll(() => projectedSlide(projector)).toBe(2);
});

test("a .pptx with timings advances by itself", async ({ app }) => {
  test.skip(!fs.existsSync(fixture("hymn.pptx")), "LibreOffice is not installed, so there is no .pptx fixture");
  await app.addMedia("ppt", "hymn.pptx");
  await app.previewFile("Presentaciones", "hymn");
  await expect(slideTile(app, 3)).toBeVisible({ timeout: 90_000 });

  await app.goLive();
  const projector = await app.projector();
  await expect.poll(() => projectedSlide(projector)).toBe(1);
  // Two seconds a slide, from the deck's own timings.
  await expect.poll(() => projectedSlide(projector), { timeout: 8_000 }).toBe(2);
  await expect.poll(() => projectedSlide(projector), { timeout: 8_000 }).toBe(3);
});

test("a WMV embedded in a .pptx slide is converted and plays on its slide", async ({ app }) => {
  test.skip(!fs.existsSync(fixture("clipdeck.pptx")), "LibreOffice is not installed, so there is no .pptx fixture");
  await app.addMedia("ppt", "clipdeck.pptx");
  await app.previewFile("Presentaciones", "clipdeck");
  await expect(slideTile(app, 1)).toBeVisible({ timeout: 90_000 });

  // Main converts the clip inside the deck's own cache and announces it
  // (`deck-updated`), so the renderer re-reads a deck that now has a video.
  await expect.poll(() => app.log.some((line) => line.includes("[convert] slide clip")), { timeout: 60_000 }).toBe(true);
  await app.control.waitForTimeout(1000);

  await app.goLive();
  const projector = await app.projector();
  await expect
    .poll(async () => (await videoStates(projector)).find((v) => v.src.includes("/deck-video/"))?.videoWidth ?? 0)
    .toBe(640);
});
