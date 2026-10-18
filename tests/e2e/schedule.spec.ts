import { expect, relaunch, test, videoStates, type WorshipApp } from "./support/app";

/** Picks a library file and adds it to the order of service with the panel's
 *  own «Agregar al programa». */
async function addToSchedule(app: WorshipApp, tab: "Videos" | "Imágenes", name: string) {
  await app.previewFile(tab, name);
  await app.control.getByRole("tabpanel", { name: tab }).getByRole("button", { name: "Agregar al programa" }).click();
}

const scheduleRows = (app: WorshipApp) =>
  app.control.getByRole("main").getByRole("list").first().getByRole("listitem");

async function buildSchedule(app: WorshipApp) {
  await app.addMedia("video", "clip.mp4");
  await app.addMedia("image", "photo.png");
  await addToSchedule(app, "Videos", "clip");
  await addToSchedule(app, "Imágenes", "photo");
  await expect(scheduleRows(app)).toHaveText([/1\s*clip/, /2\s*photo/]);
}

test("an order of service is built, saved, cleared and opened again", async ({ app }) => {
  const { control } = app;
  await buildSchedule(app);
  await expect(control.getByText("No guardado")).toBeVisible();

  await control.getByRole("button", { name: "Guardar", exact: true }).click();
  const dialog = control.getByRole("dialog", { name: "Programas" });
  await dialog.getByRole("textbox", { name: "Nombre" }).fill("Culto de prueba");
  await dialog.getByRole("button", { name: "Guardar", exact: true }).last().click();
  await expect(control.getByText("\"Culto de prueba\" guardado")).toBeVisible();
  await dialog.getByRole("button", { name: "Cerrar" }).click();
  await expect(control.getByText("No guardado")).toHaveCount(0);

  await control.getByRole("button", { name: "Nuevo programa" }).first().click();
  await expect(control.getByText("Programa vacío")).toBeVisible();

  await control.getByRole("button", { name: "Administrar programas" }).click();
  await dialog.getByRole("listitem").filter({ hasText: "Culto de prueba" }).click();
  await dialog.getByRole("button", { name: "Abrir" }).click();
  await expect(scheduleRows(app)).toHaveText([/1\s*clip/, /2\s*photo/]);
});

test("PREVIEW stays on the selected row when the schedule is reordered", async ({ app }) => {
  const { control } = app;
  await buildSchedule(app);
  await scheduleRows(app).filter({ hasText: "photo" }).click();
  await control.getByRole("button", { name: "Mover arriba" }).click();
  await expect(scheduleRows(app)).toHaveText([/1\s*photo/, /2\s*clip/]);

  // The photo moved, and PREVIEW — and so EN VIVO — moved with it.
  await app.goLive();
  const projector = await app.projector();
  await expect(projector.locator('img[src^="worship://asset/"]')).toBeVisible();
  expect(await videoStates(projector)).toEqual([]);
});

test("double-clicking a row sends it live", async ({ app }) => {
  await buildSchedule(app);
  await scheduleRows(app).filter({ hasText: "clip" }).dblclick();
  const projector = await app.projector();
  await expect.poll(async () => (await videoStates(projector))[0]?.currentTime ?? 0).toBeGreaterThan(0.3);
});

test("an unsaved order of service survives closing the app", async ({ app }) => {
  await buildSchedule(app);
  // The close guard asks, because the schedule was never saved.
  await app.quit("close");

  const again = await relaunch(app);
  await expect(again.control.getByText("Se recuperó el programa que estabas armando")).toBeVisible();
  await expect(scheduleRows(again)).toHaveText([/1\s*clip/, /2\s*photo/]);
});

test("quitting with something on the projector asks, and «Cancelar» keeps it on", async ({ app }) => {
  const { control } = app;
  await app.addMedia("image", "photo.png");
  await app.previewFile("Imágenes", "photo");
  await app.goLive();
  const projector = await app.projector();
  await expect(projector.locator('img[src^="worship://asset/"]')).toBeVisible();

  // Nothing unsaved — the only reason to ask is the screen.
  const quitting = app.quit("cancel");
  await expect(control.getByRole("dialog")).toContainText("¿Cerrar la app?");
  await quitting;
  await control.waitForTimeout(500);
  expect(app.hasProjector()).toBe(true);
  await expect(projector.locator('img[src^="worship://asset/"]')).toBeVisible();

  await app.quit("close");
});
