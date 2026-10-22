import { useEffect, type ReactNode } from "react";
import { useSettingsStore } from "@renderer/stores/settings.store";
import { I18nProvider } from "./i18n-provider";

/** Feeds the persisted `ui.locale` setting into `I18nProvider`, so changing
 *  the language in Settings takes effect immediately without a reload. Before
 *  settings finish loading it is `DEFAULT_SETTINGS`' `"es"`.
 *
 *  Also `<html lang>`, which `index.html` hardcodes: it is what a screen
 *  reader pronounces the interface with. */
export function LocaleProvider({ children }: { children: ReactNode }) {
  const locale = useSettingsStore((s) => s.settings["ui.locale"]);
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  return <I18nProvider locale={locale}>{children}</I18nProvider>;
}
