import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

/** `npm run screenshots`: `tests/e2e/screenshots.capture.ts` rewrites
 *  `docs/screenshots/`. Its own config, so `test:e2e` never does. */
export default defineConfig({ ...base, testMatch: "**/*.capture.ts" });
