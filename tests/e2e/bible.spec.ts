import { expect, test } from "./support/app";

const JUAN_3_16 = "Porque de tal manera amó Dios al mundo";
const JUAN_3_17 = "Porque no envió Dios á su Hijo al mundo";

test("a verse found by book and chapter is previewed, projected and stepped through", async ({ app }) => {
  const { control } = app;
  await control.getByRole("textbox", { name: "Buscar libro y capítulo…" }).fill("Juan 3");
  await control.keyboard.press("Enter");
  await control.getByRole("listitem").filter({ hasText: JUAN_3_16 }).click();

  // PREVIEW has it; nothing reached a projector.
  await expect(control.getByText("Juan 3:16").first()).toBeVisible();
  expect(app.hasProjector()).toBe(false);

  await app.goLive();
  const projector = await app.projector();
  await expect(projector.getByText(JUAN_3_16, { exact: false })).toBeVisible();

  // → steps the projected passage, not just the preview.
  await control.keyboard.press("ArrowRight");
  await expect(projector.getByText(JUAN_3_17, { exact: false })).toBeVisible();
  await expect(projector.getByText(JUAN_3_16, { exact: false })).toHaveCount(0);
});

test("a word search across the whole Bible finds the verse", async ({ app }) => {
  const { control } = app;
  await control.getByRole("button", { name: /Cambiar a búsqueda de texto completo/ }).click();
  await control.getByRole("textbox", { name: "Buscar texto…" }).fill("unigénito para que todo aquel");
  await control.keyboard.press("Enter");
  // Each hit says which verse it is, not just the snippet around the match.
  const hit = control.getByRole("tabpanel", { name: "Biblia" }).getByRole("listitem").first();
  await expect(hit).toContainText("Juan 3:16");
  await hit.click();
  await app.goLive();
  await expect((await app.projector()).getByText(JUAN_3_16, { exact: false })).toBeVisible();
});

test("after clicking EN VIVO, the arrows and Space still belong to the operator", async ({ app }) => {
  const { control } = app;
  await control.getByRole("textbox", { name: "Buscar libro y capítulo…" }).fill("Juan 3");
  await control.keyboard.press("Enter");
  await control.getByRole("listitem").filter({ hasText: JUAN_3_16 }).click();
  // A real mouse click leaves EN VIVO focused, the way an operator's does.
  await app.goLive();
  const projector = await app.projector();
  await expect(projector.getByText(JUAN_3_16, { exact: false })).toBeVisible();

  await control.keyboard.press("ArrowRight");
  await expect(projector.getByText(JUAN_3_17, { exact: false })).toBeVisible();
  // Space must not press EN VIVO again: that would send PREVIEW (still 3:16)
  // back to the projector.
  await control.keyboard.press("Space");
  await control.waitForTimeout(800);
  await expect(projector.getByText(JUAN_3_17, { exact: false })).toBeVisible();
  await expect(projector.getByText(JUAN_3_16, { exact: false })).toHaveCount(0);
});
