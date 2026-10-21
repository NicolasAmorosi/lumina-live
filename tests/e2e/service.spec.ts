import type { Page } from "@playwright/test";
import { fixture } from "./support/paths";
import { audioStates, expect, relaunch, test, videoStates, type WorshipApp } from "./support/app";

/**
 * A whole service, the way it is actually run: an order of service prepared
 * ahead and saved, the app closed, then opened on the day and played row by
 * row — each row checked on the projector itself. The teardown's
 * "no unexpected error" check is half the point of this one.
 */

const JUAN_3_16 = "Porque de tal manera amó Dios al mundo";

const scheduleSection = (app: WorshipApp) =>
  app.control.locator("section").filter({ has: app.control.getByRole("heading", { name: "Programa", exact: true }) });
const row = (app: WorshipApp, text: string) =>
  scheduleSection(app).getByRole("list").first().getByRole("listitem").filter({ hasText: text });

function projectedSlide(projector: Page): Promise<number | null> {
  return projector.evaluate(() => {
    const images = [...document.querySelectorAll<HTMLImageElement>('img[src^="worship://deck/"]')];
    const last = images.at(-1);
    const match = last ? /\/(\d+)$/.exec(last.src) : null;
    return match ? Number(match[1]) : null;
  });
}

async function countdownShown(projector: Page): Promise<boolean> {
  return /\d{1,2}:\d{2}/.test(await projector.locator("body").innerText());
}

async function prepare(app: WorshipApp) {
  const { control } = app;
  await app.openResources("Funciones", "Utilidades");
  await control.getByRole("list", { name: "Escenas de tiempo" }).getByRole("listitem").filter({ hasText: "Cuenta 10 minutos" }).click();
  await control.getByRole("tabpanel", { name: "Utilidades" }).getByRole("button", { name: "Agregar al programa" }).click();

  await app.answerOpenDialog(fixture("deck.pdf"));
  await scheduleSection(app).getByRole("button", { name: "Agregar medios" }).click();
  await expect(row(app, "deck")).toBeVisible();

  await app.openResources("Biblia");
  await app.openChapter("Juan 3");
  await control.getByRole("listitem").filter({ hasText: JUAN_3_16 }).click();
  await control.getByRole("tabpanel", { name: "Biblia" }).getByRole("button", { name: "Agregar al programa" }).click();

  await app.answerOpenDialog(fixture("clip.mp4"), fixture("photo.png"), fixture("song.mp3"));
  await scheduleSection(app).getByRole("button", { name: "Agregar medios" }).click();
  await expect(scheduleSection(app).getByRole("list").first().getByRole("listitem")).toHaveText([
    /Cuenta 10 minutos/,
    /deck/,
    /Juan 3:16/,
    /clip/,
    /photo/,
    /song/,
  ]);

  // Convert the deck now, the way a Saturday-night preparation would.
  await row(app, "deck").click();
  await expect(app.previewColumn().getByRole("list", { name: "Presentación" }).getByRole("button", { name: "3", exact: true })).toBeVisible({ timeout: 60_000 });

  await control.getByRole("button", { name: "Guardar", exact: true }).click();
  const programs = control.getByRole("dialog", { name: "Programas" });
  await programs.getByRole("textbox", { name: "Nombre" }).fill("Culto del sábado");
  await programs.getByRole("button", { name: "Guardar", exact: true }).last().click();
  await programs.getByRole("button", { name: "Cerrar" }).click();
}

test("a saved service is opened the next day and played row by row", async ({ app }) => {
  await prepare(app);
  await app.quit();

  const day = await relaunch(app);
  const { control } = day;
  await control.getByRole("button", { name: "Administrar programas" }).click();
  const programs = control.getByRole("dialog", { name: "Programas" });
  await programs.getByRole("listitem").filter({ hasText: "Culto del sábado" }).click();
  await programs.getByRole("button", { name: "Abrir" }).click();
  await expect(row(day, "song")).toBeVisible();

  // Before the service: the countdown.
  await row(day, "Cuenta 10 minutos").dblclick();
  const projector = await day.projector();
  await expect.poll(() => countdownShown(projector)).toBe(true);

  // The hymn: stepped by hand, covered and uncovered.
  await row(day, "deck").dblclick();
  await expect.poll(() => projectedSlide(projector)).toBe(1);
  await control.locator("body").press("ArrowRight");
  await expect.poll(() => projectedSlide(projector)).toBe(2);
  await control.locator("body").press("b");
  await expect.poll(() => projectedSlide(projector)).toBeNull();
  await control.locator("body").press("b");
  await expect.poll(() => projectedSlide(projector)).toBe(2);

  // The reading.
  await row(day, "Juan 3:16").dblclick();
  await expect(projector.getByText(JUAN_3_16, { exact: false })).toBeVisible();
  // Once the fade is over, nothing of the deck is left on the stage.
  await expect.poll(() => projectedSlide(projector)).toBeNull();

  // A video, then a picture.
  await row(day, "clip").dblclick();
  await expect.poll(async () => (await videoStates(projector))[0]?.currentTime ?? 0).toBeGreaterThan(0.5);
  await expect(projector.getByText(JUAN_3_16, { exact: false })).toHaveCount(0);
  await row(day, "photo").dblclick();
  await expect(projector.locator('img[src^="worship://asset/"]')).toBeVisible();
  await expect.poll(async () => (await videoStates(projector)).length).toBe(0);

  // Music under the picture.
  await row(day, "song").dblclick();
  await expect.poll(async () => (await audioStates(projector))[0]?.currentTime ?? 0).toBeGreaterThan(0.5);
  await expect(projector.locator('img[src^="worship://asset/"]')).toBeVisible();

  // The on-air rail follows what was sent last.
  await expect(row(day, "song")).toBeVisible();

  // And closing at the end asks, because the projector is still on.
  await day.quit("close");
});
