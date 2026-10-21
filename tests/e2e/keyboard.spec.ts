import type { Page } from "@playwright/test";
import { expect, test, type WorshipApp } from "./support/app";

/**
 * After a mouse click on a thumbnail, the arrows are the operator's shortcuts
 * — ←/→ move what is LIVE, ↑/↓ move PREVIEW — exactly as after a click on any
 * other button (decided 2026-10-18). The grids walk their tiles with the
 * arrows only when reached from the keyboard.
 */

const previewTile = (app: WorshipApp, n: number) =>
  app.previewColumn().getByRole("list", { name: "Presentación" }).getByRole("button", { name: String(n), exact: true });
const liveTile = (app: WorshipApp, n: number) =>
  app.liveColumn().getByRole("list", { name: "Presentación" }).getByRole("button", { name: String(n), exact: true });

function projectedSlide(projector: Page): Promise<number | null> {
  return projector.evaluate(() => {
    const last = [...document.querySelectorAll<HTMLImageElement>('img[src^="worship://deck/"]')].at(-1);
    const match = last ? /\/(\d+)$/.exec(last.src) : null;
    return match ? Number(match[1]) : null;
  });
}

async function deckLive(app: WorshipApp) {
  await app.addMedia("ppt", "deck.pdf");
  await app.previewFile("Presentaciones", "deck");
  await expect(previewTile(app, 3)).toBeVisible({ timeout: 60_000 });
  await app.goLive();
  const projector = await app.projector();
  await expect.poll(() => projectedSlide(projector)).toBe(1);
  return projector;
}

const selectedPreviewSlide = (app: WorshipApp) =>
  app.previewColumn().getByRole("list", { name: "Presentación" }).locator('[aria-current="true"]').textContent();

test("→ after clicking a slide in PREVIEW advances the projector", async ({ app }) => {
  const projector = await deckLive(app);
  await previewTile(app, 2).click();
  await app.control.keyboard.press("ArrowRight");
  await expect.poll(() => projectedSlide(projector)).toBe(2);
});

test("→ after clicking a slide in the LIVE grid advances the projector from there", async ({ app }) => {
  const projector = await deckLive(app);
  await liveTile(app, 2).click();
  await expect.poll(() => projectedSlide(projector)).toBe(2);
  await app.control.keyboard.press("ArrowRight");
  await expect.poll(() => projectedSlide(projector)).toBe(3);
  await app.control.keyboard.press("ArrowLeft");
  await expect.poll(() => projectedSlide(projector)).toBe(2);
});

test("↓ after clicking a library tile moves PREVIEW, and Enter sends it", async ({ app }) => {
  await app.addMedia("ppt", "deck.pdf");
  await app.previewFile("Presentaciones", "deck");
  await expect(previewTile(app, 3)).toBeVisible({ timeout: 60_000 });
  await app.control.keyboard.press("ArrowDown");
  await expect.poll(() => selectedPreviewSlide(app)).toContain("2");
  await app.control.keyboard.press("Enter");
  await expect.poll(async () => projectedSlide(await app.projector())).toBe(2);
});

test("→ after clicking a verse in the LIVE grid steps the projected passage", async ({ app }) => {
  await app.openChapter("Juan 3");
  await app.control.getByRole("listitem").filter({ hasText: "Porque de tal manera amó Dios al mundo" }).click();
  await app.goLive();
  const projector = await app.projector();
  await app.liveColumn().getByRole("list", { name: "Biblia" }).getByRole("button", { name: / 16$/ }).click();
  await app.control.keyboard.press("ArrowRight");
  await expect(projector.getByText("Porque no envió Dios á su Hijo al mundo", { exact: false })).toBeVisible();
});

test("reached with the keyboard, the arrows still walk the grid", async ({ app }) => {
  const projector = await deckLive(app);
  // Tab into the PREVIEW grid: the tab stop is the selected tile.
  await previewTile(app, 1).focus();
  await app.control.keyboard.press("ArrowRight");
  await expect(previewTile(app, 2)).toBeFocused();
  // The projector did not move: these arrows were the grid's.
  expect(await projectedSlide(projector)).toBe(1);
});

test("a tile reached with the arrows and then clicked gives Enter back to EN VIVO", async ({ app }) => {
  const projector = await deckLive(app);
  await previewTile(app, 1).focus();
  await app.control.keyboard.press("ArrowRight");
  await expect(previewTile(app, 2)).toBeFocused();
  // Clicking the tile that already has focus moves no focus at all.
  await previewTile(app, 2).click();
  await app.control.keyboard.press("Enter");
  await expect.poll(() => projectedSlide(projector)).toBe(2);
});
