import { useT } from "@renderer/lib/i18n/i18n-provider";
import { Button, Icon, Tooltip } from "@renderer/components/ui";
import { useBibleStore } from "@renderer/stores/bible.store";
import { api } from "@renderer/lib/api";
import { SettingsGroup, SettingsRow } from "../settings-row";

/** Scripture-related settings: importing bible versions. */
export function BibleSection() {
  const t = useT();
  const loadVersions = useBibleStore((s) => s.loadVersions);

  async function importVersion() {
    await api.bible.import();
    await loadVersions();
  }

  return (
    <div className="flex flex-col gap-6">
      <SettingsGroup title={t("settings.groups.versions")}>
        <SettingsRow description={t("settings.bibleImportDesc")} label={t("settings.bibleImport")}>
          <Tooltip content={t("settings.bibleImportFormats")} floating>
            <Icon className="text-subtle" name="help" />
          </Tooltip>
          <Button onClick={() => void importVersion()} variant="secondary">
            {t("bible.import")}
          </Button>
        </SettingsRow>
      </SettingsGroup>
    </div>
  );
}
