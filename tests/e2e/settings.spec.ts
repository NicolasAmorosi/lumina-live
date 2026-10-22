import type { Locator } from "@playwright/test";
import { expect, relaunch, test, videoStates, type WorshipApp } from "./support/app";

async function openSettings(
  app: WorshipApp,
  section: "Proyección" | "Diapositivas" | "Versículos" | "Biblia" | "Sistema",
): Promise<Locator> {
  await app.control.getByRole("button", { name: "Configuración" }).click();
  const dialog = app.control.getByRole("dialog", { name: "Configuración" });
  await dialog.getByRole("tab", { name: section }).click();
  return dialog;
}

const closeSettings = (settings: Locator) => settings.getByRole("button", { name: "Cerrar" }).first().click();

async function choose(app: WorshipApp, field: Locator, option: string) {
  await field.getByRole("combobox").click();
  await app.control.getByRole("option", { name: option, exact: true }).click();
}

test("the light theme applies at once and is still there after a restart", async ({ app }) => {
  const html = app.control.locator("html");
  await expect(html).toHaveAttribute("data-theme", "dark");

  const dialog = await openSettings(app, "Sistema");
  await dialog.getByRole("button", { name: "Claro", exact: true }).click();
  await expect(html).toHaveAttribute("data-theme", "light");

  await app.quit();
  const again = await relaunch(app);
  await expect(again.control.locator("html")).toHaveAttribute("data-theme", "light");
});

test("the transition chosen in Ajustes is kept after a restart", async ({ app }) => {
  let settings = await openSettings(app, "Proyección");
  await choose(app, settings.getByRole("group", { name: "Estilo", exact: true }), "Instantáneo");
  // A duration means nothing to a cut.
  await expect(settings.getByRole("group", { name: "Duración", exact: true }).getByRole("combobox")).toBeDisabled();
  await app.quit();

  const again = await relaunch(app);
  settings = await openSettings(again, "Proyección");
  await expect(settings.getByRole("group", { name: "Estilo", exact: true }).getByRole("combobox")).toHaveText(/Instantáneo/);
});

test("with the LIVE monitor's video turned off, the projector still plays it", async ({ app }) => {
  await app.addMedia("video", "clip.mp4");
  const settings = await openSettings(app, "Sistema");
  await settings.getByRole("group", { name: "Video en movimiento en el monitor En Vivo" }).getByRole("switch").click();
  await closeSettings(settings);

  await app.previewFile("Videos", "clip");
  await app.goLive();
  const projector = await app.projector();
  await expect.poll(async () => (await videoStates(projector))[0]?.currentTime ?? 0).toBeGreaterThan(0.5);
  await expect(app.liveColumn().getByText("Vista de video desactivada")).toBeVisible();
  await expect(app.liveColumn().locator("video")).toHaveCount(0);
});

test("emptying the slide cache warns about a deck on air, and a deck reconverts when opened again", async ({ app }) => {
  await app.addMedia("ppt", "deck.pdf");
  await app.previewFile("Presentaciones", "deck");
  const tile3 = app.previewColumn().getByRole("list", { name: "Presentación" }).getByRole("button", { name: "3", exact: true });
  await expect(tile3).toBeVisible({ timeout: 60_000 });
  await app.goLive();

  let settings = await openSettings(app, "Diapositivas");
  await expect(settings.getByText("1 presentación convertida y guardada en disco")).toBeVisible();
  await settings.getByRole("button", { name: "Vaciar caché" }).click();
  const confirm = app.control.getByRole("dialog", { name: "¿Vaciar la caché de diapositivas?" });
  await expect(confirm).toContainText("Hay una presentación EN VIVO");
  await confirm.getByRole("button", { name: "Cancelar" }).click();

  // Off the air, it is a plain question — and the cache really empties.
  await closeSettings(settings);
  await app.liveColumn().getByRole("button", { name: "Quitar" }).click();
  settings = await openSettings(app, "Diapositivas");
  await settings.getByRole("button", { name: "Vaciar caché" }).click();
  await expect(confirm).not.toContainText("EN VIVO");
  await confirm.getByRole("button", { name: "Vaciar caché" }).click();
  await expect(app.control.getByRole("status").filter({ hasText: "Se vació la caché de diapositivas" })).toBeVisible();
  await expect(settings.getByText("0 presentaciones convertidas y guardadas en disco")).toBeVisible();
  await closeSettings(settings);

  // The deck the control window still remembers is converted again, and what
  // goes up is a real picture — not a slide pointing at a deleted file.
  await app.previewFile("Presentaciones", "deck");
  await expect(tile3).toBeVisible({ timeout: 60_000 });
  await app.goLive();
  const projector = await app.projector();
  const slide = projector.locator('img[src^="worship://deck/"]').last();
  await expect.poll(() => slide.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBeGreaterThan(0);
});

test("«Probar video» plays a library video and gives a verdict", async ({ app }) => {
  await app.addMedia("video", "clip.mp4");
  const settings = await openSettings(app, "Sistema");
  const probe = settings.getByRole("group", { name: "Probar video", exact: true });
  await choose(app, probe, "clip");
  await probe.getByRole("button", { name: "Probar" }).click();
  await expect(
    settings.getByText(/Anda fluido en este equipo|Puede trabarse en este equipo|No recomendado en este equipo/),
  ).toBeVisible({ timeout: 30_000 });
  // It never touched the projector.
  expect(app.hasProjector()).toBe(false);
});
