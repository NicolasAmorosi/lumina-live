import { expect, relaunch, test } from "./support/app";

test("the light theme applies at once and is still there after a restart", async ({ app }) => {
  const html = app.control.locator("html");
  await expect(html).toHaveAttribute("data-theme", "dark");

  await app.control.getByRole("button", { name: "Configuración" }).click();
  const dialog = app.control.getByRole("dialog");
  await dialog.getByRole("tab", { name: "Sistema" }).click();
  await dialog.getByRole("button", { name: "Claro", exact: true }).click();
  await expect(html).toHaveAttribute("data-theme", "light");

  await app.quit();
  const again = await relaunch(app);
  await expect(again.control.locator("html")).toHaveAttribute("data-theme", "light");
});
