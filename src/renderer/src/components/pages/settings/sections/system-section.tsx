import type { Locale } from "@shared/types/settings";
import { availableLocales, useT } from "@renderer/lib/i18n/i18n-provider";
import { Button, Icon, Select } from "@renderer/components/ui";
import { useSettingsStore } from "@renderer/stores/settings.store";
import { SettingsGroup, SettingsRow } from "../settings-row";

const LOCALE_LABEL_KEYS: Record<Locale, string> = {
  es: "settings.locales.es",
  it: "settings.locales.it",
  en: "settings.locales.en",
};

/** App-wide preferences that aren't about projection: theme and language. */
export function SystemSection() {
  const t = useT();
  const theme = useSettingsStore((s) => s.settings["ui.theme"]);
  const locale = useSettingsStore((s) => s.settings["ui.locale"]);
  const updateSettings = useSettingsStore((s) => s.update);

  return (
    <div className="flex flex-col gap-6">
      <SettingsGroup title={t("settings.groups.appearance")}>
        <SettingsRow description={t("settings.themeDesc")} label={t("settings.theme")}>
          <div className="inline-flex rounded-lg border border-border p-0.5">
            <Button
              onClick={() => void updateSettings({ "ui.theme": "dark" })}
              size="sm"
              toggled={theme === "dark"}
              variant="ghost"
            >
              <Icon name="moon" /> {t("settings.themeDark")}
            </Button>
            <Button
              onClick={() => void updateSettings({ "ui.theme": "light" })}
              size="sm"
              toggled={theme === "light"}
              variant="ghost"
            >
              <Icon name="sun" /> {t("settings.themeLight")}
            </Button>
          </div>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title={t("settings.groups.language")}>
        <SettingsRow description={t("settings.languageDesc")} label={t("settings.language")}>
          <Select
            className="min-w-40"
            onChange={(value) => void updateSettings({ "ui.locale": value as Locale })}
            options={availableLocales.map((l) => ({ label: t(LOCALE_LABEL_KEYS[l]), value: l }))}
            size="md"
            value={locale}
          />
        </SettingsRow>
      </SettingsGroup>
    </div>
  );
}
