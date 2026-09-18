import { useState } from "react";
import { useT } from "@renderer/lib/i18n/i18n-provider";
import { Button, Icon, Tooltip } from "@renderer/components/ui";
import { useBibleStore } from "@renderer/stores/bible.store";
import { api } from "@renderer/lib/api";
import { toast } from "@renderer/lib/toast";
import { SettingsGroup, SettingsRow } from "../settings-row";

/** Scripture-related settings: importing bible versions. */
export function BibleSection() {
  const t = useT();
  const loadVersions = useBibleStore((s) => s.loadVersions);
  const [importing, setImporting] = useState(false);

  /**
   * Importing is seconds of work with nothing on screen to say so: measured at
   * ~590 ms for the RV1960 bundle (31 102 verses), and it is all synchronous
   * work in main — 457 ms of INSERTs, 47 ms rebuilding the FTS5 index, 11 ms
   * of JSON. That is long enough for a second click to start a second import,
   * and long enough that silence reads as a broken button.
   *
   * `null` means the operator dismissed the file dialog, which is not an
   * outcome worth a toast. A rejection is a real failure — a JSON whose shape
   * `parseBibleSource` cannot recognize — and has to be said out loud, since
   * the alternative is a version that simply never appears in the list.
   */
  async function importVersion() {
    setImporting(true);
    try {
      const version = await api.bible.import();
      if (version === null) return;
      await loadVersions();
      toast.success(t("bible.importSucceeded", { name: version.name, verses: version.verseCount }));
    } catch (error) {
      console.error("[bible] import failed", error);
      toast.danger(t("bible.importFailed"));
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <SettingsGroup title={t("settings.groups.versions")}>
        <SettingsRow description={t("settings.bibleImportDesc")} label={t("settings.bibleImport")}>
          <Tooltip content={t("settings.bibleImportFormats")} floating>
            <Icon className="text-subtle" name="help" />
          </Tooltip>
          <Button
            loading={importing}
            loadingLabel={t("bible.importing")}
            onClick={() => void importVersion()}
            variant="secondary"
          >
            {t("bible.import")}
          </Button>
        </SettingsRow>
      </SettingsGroup>
    </div>
  );
}
