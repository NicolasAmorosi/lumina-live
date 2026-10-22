import { app } from "electron";
import type { Locale } from "@shared/types/settings";
import { toLocale } from "./index";

/**
 * The interface language a new install starts in: the first of the OS's
 * preferred languages the app speaks, or English when it speaks none of them
 * (a French or German church can read English sooner than Spanish). An
 * explicit `--lang` goes first — it is how the E2E suite pins Spanish.
 *
 * Written to the settings only on the first launch of a new profile
 * (`index.ts`): an existing install keeps the Spanish it has always had,
 * whatever the OS says.
 */
export function systemLocale(): Locale {
  for (const tag of [app.commandLine.getSwitchValue("lang"), ...app.getPreferredSystemLanguages()]) {
    const locale = toLocale(tag);
    if (locale) return locale;
  }
  return "en";
}
