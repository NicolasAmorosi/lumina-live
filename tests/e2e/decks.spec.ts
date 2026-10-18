import fs from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import type { MediaAsset } from "../../src/shared/types/media";
import { fixture } from "./support/paths";
import { buildPdf } from "./support/pdf";
import { audioStates, expect, relaunch, test, videoStates, type WorshipApp } from "./support/app";

/** A rasterized slide in the centre grid, once the deck is converted. */
const slideTile = (app: WorshipApp, n: number) =>
  app.previewColumn().getByRole("list", { name: "Presentación" }).getByRole("button", { name: String(n), exact: true });

/** The same slide in the LIVE column's grid, which only exists while the deck
 *  is on the projector. */
const liveSlideTile = (app: WorshipApp, n: number) =>
  app.liveColumn().getByRole("list", { name: "Presentación" }).getByRole("button", { name: String(n), exact: true });

const hasHymn = () => fs.existsSync(fixture("hymn.pptx"));

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
  test.skip(!hasHymn(), "LibreOffice is not installed, so there is no .pptx fixture");
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

test("a slide clicked in the LIVE grid goes up at once; one clicked in PREVIEW does not", async ({ app }) => {
  await app.addMedia("ppt", "deck.pdf");
  await app.previewFile("Presentaciones", "deck");
  await expect(slideTile(app, 3)).toBeVisible({ timeout: 60_000 });
  await app.goLive();
  const projector = await app.projector();
  await expect.poll(() => projectedSlide(projector)).toBe(1);

  await slideTile(app, 3).click();
  await app.control.waitForTimeout(500);
  expect(await projectedSlide(projector)).toBe(1);

  await liveSlideTile(app, 3).click();
  await expect.poll(() => projectedSlide(projector)).toBe(3);
  const live = app.liveColumn();
  await expect(live.getByText("3/3", { exact: true })).toBeVisible();
  await expect(live.getByRole("button", { name: "Siguiente" })).toBeDisabled();
  await live.getByRole("button", { name: "Anterior" }).click();
  await expect.poll(() => projectedSlide(projector)).toBe(2);

  // A double click in PREVIEW on a deck that is already live jumps there too.
  await slideTile(app, 1).dblclick();
  await expect.poll(() => projectedSlide(projector)).toBe(1);
});

test("Space freezes a deck that advances by itself, and resumes it", async ({ app }) => {
  test.skip(!hasHymn(), "LibreOffice is not installed, so there is no .pptx fixture");
  await app.addMedia("ppt", "hymn.pptx");
  await app.previewFile("Presentaciones", "hymn");
  await expect(slideTile(app, 3)).toBeVisible({ timeout: 90_000 });
  await app.goLive();
  const projector = await app.projector();
  await expect.poll(() => projectedSlide(projector)).toBe(1);

  await app.control.locator("body").press("Space");
  await expect(app.liveColumn().getByRole("button", { name: "Reproducir", exact: true })).toBeVisible();
  // Two seconds a slide: four seconds frozen would have been two slides.
  await app.control.waitForTimeout(4000);
  expect(await projectedSlide(projector)).toBe(1);

  await app.liveColumn().getByRole("button", { name: "Reproducir", exact: true }).click();
  await expect.poll(() => projectedSlide(projector), { timeout: 6_000 }).toBe(2);
});

test("a deck that advances by itself leaves the projector after its last slide", async ({ app }) => {
  test.skip(!hasHymn(), "LibreOffice is not installed, so there is no .pptx fixture");
  await app.addMedia("ppt", "hymn.pptx");
  await app.previewFile("Presentaciones", "hymn");
  await expect(slideTile(app, 3)).toBeVisible({ timeout: 90_000 });
  await app.goLive();
  const projector = await app.projector();
  await expect.poll(() => projectedSlide(projector), { timeout: 10_000 }).toBe(3);
  await expect.poll(() => projectedSlide(projector), { timeout: 10_000 }).toBeNull();
  await expect(app.liveColumn().getByRole("button", { name: "Siguiente" })).toHaveCount(0);
});

test("a song assigned to a deck plays under it, and NEGRO pauses the song and the slides together", async ({ app }) => {
  test.skip(!hasHymn(), "LibreOffice is not installed, so there is no .pptx fixture");
  await app.addMedia("ppt", "hymn.pptx");
  await app.previewFile("Presentaciones", "hymn");
  await expect(slideTile(app, 3)).toBeVisible({ timeout: 90_000 });

  const preview = app.previewColumn();
  await expect(preview.getByText("Sin audio")).toBeVisible();
  await app.answerOpenDialog(fixture("song.mp3"));
  await preview.getByRole("button", { name: "Asignar audio" }).click();
  await expect(preview.getByText("song", { exact: false }).first()).toBeVisible();
  await expect(preview.getByRole("button", { name: "Cambiar", exact: true })).toBeVisible();

  await app.goLive();
  const projector = await app.projector();
  await expect.poll(async () => (await audioStates(projector))[0]?.currentTime ?? 0).toBeGreaterThan(0.3);
  await expect(app.liveColumn().getByText("hymn (música)")).toBeVisible();

  await app.control.locator("body").press("b");
  await expect.poll(async () => (await audioStates(projector))[0]?.paused).toBe(true);
  const coveredAt = (await audioStates(projector))[0]?.currentTime ?? 0;
  await app.control.waitForTimeout(3000);
  expect((await audioStates(projector))[0]?.currentTime).toBeCloseTo(coveredAt, 1);

  await app.control.locator("body").press("b");
  await expect.poll(async () => (await audioStates(projector))[0]?.paused).toBe(false);
  // The slide under the cover is still the one its music was on.
  const expected = Math.min(3, Math.floor(coveredAt / 2) + 1);
  expect(await projectedSlide(projector)).toBe(expected);
  await expect.poll(() => projectedSlide(projector), { timeout: 6_000 }).toBe(expected + 1);

  // And it stays assigned: «Quitar» on the strip takes it back off.
  await preview.getByRole("button", { name: "Quitar", exact: true }).first().click();
  await expect(preview.getByText("Sin audio")).toBeVisible();
});

test("a deck that cannot be converted says so and can be retried", async ({ app }) => {
  const broken = path.join(app.profile, "roto.pdf");
  fs.writeFileSync(broken, "%PDF-1.4\nthis is not a pdf\n");
  await app.invoke<MediaAsset[]>("library:add", { kind: "ppt", paths: [broken] });
  await app.previewFile("Presentaciones", "roto");
  await expect(app.previewColumn().getByText("No se pudo convertir la presentación").first()).toBeVisible({ timeout: 60_000 });

  // Fixed on disk, then retried from the same panel — unless the library sweep
  // saw the edit first and reconverted it on its own, which is just as right.
  fs.writeFileSync(broken, buildPdf(["#1f4e9c", "#c0392b"]));
  const retry = app.previewColumn().getByRole("button", { name: "Reintentar" }).first();
  await expect(async () => {
    if (await retry.isVisible()) await retry.click({ timeout: 2_000 });
    await expect(slideTile(app, 2)).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 60_000 });
  await app.goLive();
  await expect.poll(async () => projectedSlide(await app.projector())).toBe(1);
});

test("a deck edited on disk is converted again the next time it is opened", async ({ app }) => {
  const file = path.join(app.profile, "anuncios.pdf");
  fs.writeFileSync(file, buildPdf(["#1f4e9c", "#c0392b", "#27ae60"]));
  await app.invoke<MediaAsset[]>("library:add", { kind: "ppt", paths: [file] });
  await app.addMedia("ppt", "deck.pdf");
  await app.previewFile("Presentaciones", "anuncios");
  await expect(slideTile(app, 3)).toBeVisible({ timeout: 60_000 });

  // Someone takes a slide out during the week.
  fs.writeFileSync(file, buildPdf(["#1f4e9c", "#27ae60"]));
  await app.previewFile("Presentaciones", "deck");
  await expect(slideTile(app, 3)).toBeVisible({ timeout: 60_000 });
  await app.previewFile("Presentaciones", "anuncios");
  await expect(slideTile(app, 2)).toBeVisible({ timeout: 60_000 });
  await expect(slideTile(app, 3)).toHaveCount(0);
  // And the projector gets the edited deck, not last week's.
  await app.goLive();
  await expect(liveSlideTile(app, 2)).toBeVisible();
  await expect(liveSlideTile(app, 3)).toHaveCount(0);
});

test("a deck edited while the app was closed is not projected from the old cache", async ({ app }) => {
  const file = path.join(app.profile, "anuncios.pdf");
  fs.writeFileSync(file, buildPdf(["#1f4e9c", "#c0392b", "#27ae60"]));
  await app.invoke<MediaAsset[]>("library:add", { kind: "ppt", paths: [file] });
  await app.previewFile("Presentaciones", "anuncios");
  await expect(slideTile(app, 3)).toBeVisible({ timeout: 60_000 });
  await app.quit();

  fs.writeFileSync(file, buildPdf(["#1f4e9c", "#27ae60"]));
  const again = await relaunch(app);
  await again.previewFile("Presentaciones", "anuncios");
  await expect(slideTile(again, 2)).toBeVisible({ timeout: 60_000 });
  await expect(slideTile(again, 3)).toHaveCount(0);
  await again.goLive();
  await expect(liveSlideTile(again, 2)).toBeVisible();
  await expect(liveSlideTile(again, 3)).toHaveCount(0);
});

test("a deck finished in the background after the operator cancelled it shows its slides, not «Preparando…»", async ({ app }) => {
  test.skip(!hasHymn(), "LibreOffice is not installed, so there is no .pptx fixture");
  const [hymn] = await app.addMedia("ppt", "hymn.pptx");
  if (!hymn) throw new Error("import failed");
  await app.previewFile("Presentaciones", "hymn");
  const preview = app.previewColumn();
  // Main's own word that the job stopped: until its `soffice` is gone, a new
  // request for the same deck joins the dying job instead of starting one.
  type Bridge = { worship: { on: (channel: string, cb: (payload: { status: string }) => void) => void } };
  const stopped = app.control.evaluate(
    () =>
      new Promise<void>((resolve) =>
        (window as unknown as Bridge).worship.on("deck-progress", (p) => {
          if (p.status === "stale") resolve();
        }),
      ),
  );
  await preview.getByRole("button", { name: "Cancelar" }).first().click();
  await expect(preview.getByText("Conversión cancelada").first()).toBeVisible();
  await stopped;

  // Later the background prewarm (the library's visible decks, the
  // schedule's) converts it after all — with nobody in the control window
  // awaiting that job.
  await app.invoke("deck:prewarm", { assetIds: [hymn.id], scope: "explicit" });
  await expect(slideTile(app, 3)).toBeVisible({ timeout: 90_000 });
  await expect(preview.getByText("Preparando la conversión…")).toHaveCount(0);
});

test("cancelling a deck that is still waiting in line says so", async ({ app }) => {
  test.skip(!hasHymn() || !fs.existsSync(fixture("clipdeck.pptx")), "LibreOffice is not installed, so there is no .pptx fixture");
  await app.addMedia("ppt", "hymn.pptx", "clipdeck.pptx");
  // The hymn converts first; the second deck waits behind it.
  await app.previewFile("Presentaciones", "hymn");
  await app.previewFile("Presentaciones", "clipdeck");
  const preview = app.previewColumn();
  await preview.getByRole("button", { name: "Cancelar" }).first().click();
  await expect(preview.getByText("Conversión cancelada").first()).toBeVisible();
  await expect(preview.getByText("Preparando la conversión…")).toHaveCount(0);
});
