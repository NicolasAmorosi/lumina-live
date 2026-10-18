import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { _electron as electron, test as base, expect, type ElectronApplication, type Page } from "@playwright/test";
import type { AssetKind } from "../../../src/shared/constants";
import type { MediaAsset } from "../../../src/shared/types/media";
import { ROOT, fixture } from "./paths";

/**
 * The launch flags from the CDP recipe
 * (`.claude/knowledge/occluded-electron-window-has-no-rendering-lifecycle.md`):
 * without them a control window hidden behind the fullscreen projector stops
 * rendering, and input reaches it seconds late.
 */
const FLAGS = [
  "--disable-backgrounding-occluded-windows",
  "--disable-renderer-backgrounding",
  "--disable-background-timer-throttling",
];

/** What the renderer's global handlers log before showing the "error
 *  inesperado" toast (`lib/global-error-handlers.ts`), plus main's crash path.
 *  Any of these in a run is a bug, whatever the test was checking. */
const UNEXPECTED = [/\[renderer\] unhandled rejection/, /\[renderer\] uncaught error/, /\[uncaughtException\]/];

export class WorshipApp {
  /** Resolves when the process is gone. Tracked here because Playwright
   *  disposes `electron.process()` along with the app once it has exited. */
  readonly exited: Promise<void>;
  private hasExited = false;

  private constructor(
    readonly electron: ElectronApplication,
    readonly control: Page,
    readonly profile: string,
    readonly log: string[],
  ) {
    this.exited = new Promise((resolve) =>
      electron.process().once("exit", () => {
        this.hasExited = true;
        resolve();
      }),
    );
  }

  /** Starts the built app on `profile`, an empty directory for a first launch
   *  or a previous run's for a relaunch. */
  static async launch(profile: string): Promise<WorshipApp> {
    // `WORSHIP_E2E_EXECUTABLE` runs the suite against an INSTALLED build
    // (`release/mac-arm64/WorshipApp.app/Contents/MacOS/WorshipApp`, or
    // `WorshipApp.exe` on the church PC) instead of `electron .` on `out/`:
    // what ships resolves FFmpeg, the migrations and the bibles from the
    // package's own `resources/`, which only a packaged run exercises.
    const executable = process.env["WORSHIP_E2E_EXECUTABLE"];
    const app = await electron.launch({
      cwd: ROOT,
      ...(executable
        ? { executablePath: executable, args: [`--user-data-dir=${profile}`, ...FLAGS] }
        : { args: [ROOT, `--user-data-dir=${profile}`, ...FLAGS] }),
      // Sends every renderer `console.*` to stderr, so the log has both sides.
      env: { ...process.env, ELECTRON_ENABLE_LOGGING: "1" },
    });
    const log: string[] = [];
    const collect = (chunk: Buffer) => log.push(...String(chunk).split("\n").filter((line) => line.trim() !== ""));
    app.process().stdout?.on("data", collect);
    app.process().stderr?.on("data", collect);

    const control = await app.firstWindow();
    await expect(control.getByRole("button", { name: "EN VIVO", exact: true })).toBeVisible();
    return new WorshipApp(app, control, profile, log);
  }

  /** An IPC call through the same bridge the UI uses. For SETUP only — what a
   *  test checks goes through the real UI (native dialogs are the reason this
   *  exists: CDP cannot drive them). */
  async invoke<T>(channel: string, req?: unknown): Promise<T> {
    type Bridge = { worship: { invoke: (channel: string, req: unknown) => Promise<unknown> } };
    const result = await this.control.evaluate(
      ([c, r]) => (window as unknown as Bridge).worship.invoke(c, r),
      [channel, req] as const,
    );
    const typed = result as { ok: true; data: T } | { ok: false; error: { code: string; message: string } };
    if (!typed.ok) throw new Error(`${channel} → ${typed.error.code}: ${typed.error.message}`);
    return typed.data;
  }

  /** Adds generated fixtures to the library, as "Agregar" would. */
  addMedia(kind: AssetKind, ...names: string[]): Promise<MediaAsset[]> {
    return this.invoke<MediaAsset[]>("library:add", { kind, paths: names.map(fixture) });
  }

  /** The top bar's EN VIVO, which every kind of content shares. (A plate's
   *  own row carries a second one, and so does a time scene's.) */
  goLive(): Promise<void> {
    return this.control.getByRole("button", { name: "EN VIVO", exact: true }).first().click();
  }

  /** A resource tab, and one of its inner tabs. */
  async openResources(
    tab: "Biblia" | "Media" | "Funciones",
    inner?: "Videos" | "Imágenes" | "Audios" | "Presentaciones" | "Utilidades" | "Overlays",
  ): Promise<void> {
    await this.control.getByRole("tab", { name: tab }).click();
    if (inner) await this.control.getByRole("tab", { name: inner }).click();
  }

  /** Clicks a library tile: PREVIEW only. */
  async previewFile(inner: "Videos" | "Imágenes" | "Audios" | "Presentaciones", name: string): Promise<void> {
    await this.openResources("Media", inner);
    await this.control.getByRole("tabpanel", { name: inner }).getByRole("button", { name }).first().click();
  }

  /** The projection window. It only exists once something went live. */
  async projector(): Promise<Page> {
    const open = this.electron.windows().find((page) => page.url().endsWith("/projection.html"));
    const page =
      open ??
      (await this.electron.waitForEvent("window", { predicate: (p) => p.url().endsWith("/projection.html") }));
    await page.waitForLoadState("domcontentloaded");
    return page;
  }

  hasProjector(): boolean {
    return this.electron.windows().some((page) => page.url().endsWith("/projection.html"));
  }

  unexpectedErrors(): string[] {
    return this.log.filter((line) => UNEXPECTED.some((pattern) => pattern.test(line)));
  }

  /**
   * A real quit, the way ⌘Q / closing the window does it: through
   * `before-quit` and the close guard. `answer` is what to do if the control
   * window asks first («Cerrar igualmente» or «Cancelar»); with "cancel" the
   * app must stay alive, so this resolves once the question is answered.
   */
  async quit(answer: "close" | "cancel" = "close"): Promise<void> {
    const exited = this.exited;
    await this.electron.evaluate(({ app }) => app.quit());
    const dialog = this.control.getByRole("dialog");
    const asked = dialog.waitFor({ state: "visible", timeout: 5_000 }).then(
      () => true,
      () => false,
    );
    if (await Promise.race([exited.then(() => false), asked])) {
      await dialog.getByRole("button", { name: answer === "close" ? "Cerrar igualmente" : "Cancelar" }).click();
      if (answer === "cancel") {
        await expect(dialog).toBeHidden();
        return;
      }
    }
    await exited;
  }

  /** Teardown: ends the process without asking anything. */
  async kill(): Promise<void> {
    if (this.hasExited) return;
    await this.electron.evaluate(({ app }) => app.exit(0)).catch(() => undefined);
    await this.exited;
  }
}

/** The video elements of a window, as numbers a test can compare. */
export function videoStates(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll("video")].map((video) => ({
      src: video.currentSrc || video.src,
      currentTime: video.currentTime,
      paused: video.paused,
      videoWidth: video.videoWidth,
      readyState: video.readyState,
      opacity: Number(getComputedStyle(video).opacity),
    })),
  );
}

export function audioStates(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll("audio")].map((audio) => ({
      src: audio.currentSrc || audio.src,
      currentTime: audio.currentTime,
      paused: audio.paused,
      readyState: audio.readyState,
    })),
  );
}

type Fixtures = { app: WorshipApp; profileDir: string };

export const test = base.extend<Fixtures>({
  // A fresh profile per test, removed afterwards. Playwright requires the
  // destructuring pattern even for a fixture that needs no other fixture.
  // eslint-disable-next-line no-empty-pattern -- Playwright's fixture signature
  profileDir: async ({}, use) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "worship-e2e-profile-"));
    await use(dir);
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  },

  app: async ({ profileDir }, use, testInfo) => {
    const app = await WorshipApp.launch(profileDir);
    await use(app);
    // Whatever app the test ended with — it may have relaunched — is the one
    // registered last; tests that relaunch call `adopt` below.
    const current = adopted.get(testInfo.testId) ?? app;
    if (testInfo.status !== testInfo.expectedStatus) {
      for (const [index, page] of current.electron.windows().entries()) {
        const file = testInfo.outputPath(`window-${index}-${path.basename(page.url())}.png`);
        if (await page.screenshot({ path: file }).catch(() => null)) await testInfo.attach(path.basename(file), { path: file });
      }
    }
    await testInfo.attach("app.log", { body: [...app.log, ...(current === app ? [] : current.log)].join("\n") });
    const errors = [...app.unexpectedErrors(), ...(current === app ? [] : current.unexpectedErrors())];
    await current.kill();
    await app.kill();
    expect(errors, "the app logged an unexpected error").toEqual([]);
  },
});

const adopted = new Map<string, WorshipApp>();

/** For a test that quits and relaunches: makes teardown clean up (and check)
 *  the new instance too. */
export async function relaunch(app: WorshipApp): Promise<WorshipApp> {
  const next = await WorshipApp.launch(app.profile);
  adopted.set(test.info().testId, next);
  return next;
}

export { expect };
