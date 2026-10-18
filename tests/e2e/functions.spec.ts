import type { Page } from "@playwright/test";
import { expect, test } from "./support/app";

/** Seconds left on the projected countdown, read off its `m:ss`. */
async function countdownSeconds(projector: Page): Promise<number | null> {
  const text = await projector.locator("body").innerText();
  const match = /(\d{1,2}):(\d{2})/.exec(text);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

test("a countdown is projected and runs", async ({ app }) => {
  await app.openResources("Funciones", "Utilidades");
  await app.control.getByRole("list", { name: "Escenas de tiempo" }).getByRole("listitem").filter({ hasText: "Cuenta 10 minutos" }).click();
  await app.goLive();
  const projector = await app.projector();
  await expect.poll(() => countdownSeconds(projector)).not.toBeNull();
  const first = (await countdownSeconds(projector)) ?? 0;
  expect(first).toBeLessThanOrEqual(600);
  await expect.poll(() => countdownSeconds(projector), { timeout: 5_000 }).toBeLessThan(first);
});

test("a plate made in the editor goes up over what is live", async ({ app }) => {
  const { control } = app;
  const [photo] = await app.addMedia("image", "photo.png");
  await app.previewFile("Imágenes", "photo");
  await app.goLive();
  const projector = await app.projector();
  await expect(projector.locator(`img[src="worship://asset/${photo?.id}"]`)).toBeVisible();

  // An empty Overlays panel opens the editor straight on a new plate.
  await app.openResources("Funciones", "Overlays");
  await control.getByRole("tabpanel", { name: "Overlays" }).getByRole("button", { name: "Nueva placa" }).click();
  const editor = control.getByRole("dialog", { name: "Placas" });
  await editor.getByRole("group", { name: "Título", exact: true }).getByRole("textbox").fill("Pr. Juan Pérez");
  await editor.getByRole("button", { name: "Guardar", exact: true }).click();
  await editor.getByRole("button", { name: "Cerrar" }).click();

  await control.getByRole("tabpanel", { name: "Overlays" }).getByRole("listitem").filter({ hasText: "Placa nueva" }).click();
  await app.goLive();
  await expect(projector.getByText("Pr. Juan Pérez")).toBeVisible();
  // Over the image, not instead of it.
  await expect(projector.locator(`img[src="worship://asset/${photo?.id}"]`)).toBeVisible();
});
