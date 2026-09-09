import { useT } from "@renderer/lib/i18n/i18n-provider";
import { Button, Icon, Select } from "@renderer/components/ui";
import { useDisplayStore } from "@renderer/stores/display.store";
import { useProjectionStore } from "@renderer/stores/projection.store";
import { useSettingsStore } from "@renderer/stores/settings.store";
import { clearLive } from "@renderer/lib/actions/playback";
import { api } from "@renderer/lib/api";
import { LOGO_URL } from "@shared/urls";
import { SettingsGroup, SettingsRow } from "../settings-row";

/** Everything about what the projector shows: which screen, the fallback
 *  logo, and clearing whatever is currently live. */
export function ProjectionSection() {
  const t = useT();
  const { displayId, displays, setDisplayId } = useDisplayStore();
  const presentationOpen = useProjectionStore((s) => s.presentationOpen);
  const base = useProjectionStore((s) => s.base);
  const logoPath = useSettingsStore((s) => s.settings["logo.path"]);

  // The URL carries the logo's own path as a cache-buster: it's the same
  // "worship://logo" host for every logo, so without something in the URL
  // that actually changes when the file changes, the <img> keeps showing the
  // previous image after picking a new one (React sees an unchanged `src`
  // and never re-fetches).
  const logoUrl = logoPath ? `${LOGO_URL}?p=${encodeURIComponent(logoPath)}` : null;

  async function changeLogo() {
    await api.files.setLogo();
    // Refreshes `settings.store` from the DB — this drives both this
    // thumbnail and (via App.tsx) the logo actually shown on the projector.
    await useSettingsStore.getState().load();
  }

  return (
    <div className="flex flex-col gap-6">
      <SettingsGroup title={t("settings.groups.screen")}>
        <SettingsRow description={t("settings.displayDesc")} label={t("settings.display")}>
          <Select
            className="min-w-56"
            onChange={(value) => void setDisplayId(Number(value))}
            options={displays.map((d) => ({
              label: `${d.label}${d.primary ? ` ${t("header.primaryDisplay")}` : ""}`,
              value: String(d.id),
            }))}
            size="md"
            value={displayId !== null ? String(displayId) : ""}
          />
        </SettingsRow>
        <SettingsRow description={t("settings.windowDesc")} label={t("settings.windowLabel")}>
          {presentationOpen ? (
            <Button onClick={() => void useDisplayStore.getState().close()} variant="secondary">
              {t("header.closeDisplay")}
            </Button>
          ) : (
            <Button disabled={displayId === null} onClick={() => void useDisplayStore.getState().open()}>
              {t("header.openDisplay")}
            </Button>
          )}
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title={t("settings.groups.logo")}>
        <SettingsRow description={t("settings.logoDesc")} label={t("settings.logo")}>
          <span className="flex size-9 items-center justify-center overflow-hidden rounded-md border border-border bg-black">
            {logoUrl ? (
              <img alt="" className="size-full object-contain" src={logoUrl} />
            ) : (
              <Icon className="text-subtle" name="image" />
            )}
          </span>
          <Button onClick={() => void changeLogo()} variant="secondary">
            {t("settings.chooseFile")}
          </Button>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title={t("settings.groups.liveContent")}>
        <SettingsRow description={t("settings.clearLiveDesc")} label={t("settings.clearLive")}>
          <Button disabled={base === null} onClick={clearLive} variant="outline">
            <Icon name="close" /> {t("footer.clear")}
          </Button>
        </SettingsRow>
      </SettingsGroup>
    </div>
  );
}
