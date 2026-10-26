import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import type { Locator } from "@playwright/test";
import { expect, test, type WorshipApp } from "./support/app";
import { ROOT } from "./support/paths";

const VERSION = (JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as { version: string }).version;

async function openAbout(app: WorshipApp): Promise<Locator> {
  await app.control.getByRole("button", { name: "Configuración" }).click();
  const dialog = app.control.getByRole("dialog", { name: "Configuración" });
  await dialog.getByRole("tab", { name: "Acerca de" }).click();
  return dialog;
}

const updatesRow = (about: Locator) => about.getByRole("group", { name: /^Actualizaciones/ });

/** What a release's `latest*.yml` says, as far as a check reads it. */
const releaseYml = (version: string) =>
  [
    `version: ${version}`,
    "files:",
    "  - url: Lumina-Live-mac-arm64.dmg",
    "    sha512: AAAA",
    "    size: 1",
    "path: Lumina-Live-mac-arm64.dmg",
    "sha512: AAAA",
    "releaseDate: '2026-10-25T00:00:00.000Z'",
  ].join("\n");

test("a build that cannot update itself says so and offers no check", async ({ app }) => {
  // The packaged app CAN update itself, and would reach GitHub.
  test.skip(!!process.env["WORSHIP_E2E_EXECUTABLE"], "only `out/` is a build without updates");
  const row = updatesRow(await openAbout(app));
  await expect(row).toContainText("Esta instalación no se actualiza desde la app");
  await expect(row.getByRole("button", { name: "Buscar actualizaciones" })).toBeDisabled();
});

test.describe("against a release server", () => {
  /** The `latest*.yml` the server answers with; `null` answers 404, like a
   *  release published before the app could update itself. */
  let yml: string | null = null;
  const server = http.createServer((req, res) => {
    // The updater appends `?noCache=…`.
    const file = new URL(req.url ?? "/", "http://localhost").pathname;
    if (yml !== null && file.endsWith(".yml")) {
      res.writeHead(200, { "content-type": "text/yaml" });
      res.end(yml);
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  test.beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    process.env["WORSHIP_UPDATE_FEED_URL"] = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  });
  test.afterAll(async () => {
    // One worker runs every spec: nothing after this file may see the feed.
    delete process.env["WORSHIP_UPDATE_FEED_URL"];
    await new Promise((resolve) => server.close(resolve));
  });

  test("«Buscar actualizaciones» shows a newer version right there, with its release notes", async ({ app }) => {
    yml = releaseYml("99.0.0");
    const row = updatesRow(await openAbout(app));
    await expect(row.getByRole("button", { name: "Novedades" })).toHaveCount(0);

    await row.getByRole("button", { name: "Buscar actualizaciones" }).click();
    await expect(row).toContainText("Lumina Live 99.0.0 está disponible.");
    await expect(row.getByText("Nueva versión", { exact: true })).toBeVisible();
    await expect(row.getByRole("button", { name: "Novedades" })).toBeVisible();
  });

  test("the same version as this one is «the latest»", async ({ app }) => {
    yml = releaseYml(VERSION);
    const row = updatesRow(await openAbout(app));
    await row.getByRole("button", { name: "Buscar actualizaciones" }).click();
    await expect(row).toContainText(/Tenés la última versión \(buscada a las \d{2}:\d{2}\)\./);
    await expect(row.getByRole("button", { name: "Novedades" })).toHaveCount(0);
  });

  test("a release without update files says where the new version is", async ({ app }) => {
    yml = null;
    const row = updatesRow(await openAbout(app));
    await row.getByRole("button", { name: "Buscar actualizaciones" }).click();
    await expect(row).toContainText("La versión publicada todavía no se puede bajar desde la app");
    // It can be asked again.
    await expect(row.getByRole("button", { name: "Buscar actualizaciones" })).toBeEnabled();
  });
});
