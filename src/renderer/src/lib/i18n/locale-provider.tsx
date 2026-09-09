import type { ReactNode } from "react";
import { useSettingsStore } from "@renderer/stores/settings.store";
import { I18nProvider } from "./i18n-provider";

/** Feeds the persisted `ui.locale` setting into `I18nProvider`, so changing
 *  the language in Settings takes effect immediately without a reload.
 *  `I18nProvider` already falls back to Spanish for a locale with no
 *  dictionary, so this is safe before settings finish loading (they start at
 *  `DEFAULT_SETTINGS`, i.e. `"es"`). */
export function LocaleProvider({ children }: { children: ReactNode }) {
  const locale = useSettingsStore((s) => s.settings["ui.locale"]);
  return <I18nProvider locale={locale}>{children}</I18nProvider>;
}
