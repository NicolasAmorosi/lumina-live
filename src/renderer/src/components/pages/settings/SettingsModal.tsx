import type { ReactNode } from "react";
import { useT } from "@renderer/lib/i18n/i18n-provider";
import { Modal } from "@renderer/components/shared/modal/Modal";
import { Button, DialogContent, DialogFooter, DialogHeader, Icon, Select, Title } from "@renderer/components/ui";
import { useDisplayStore } from "@renderer/stores/display.store";
import { useProjectionStore } from "@renderer/stores/projection.store";
import { useSettingsStore } from "@renderer/stores/settings.store";
import { clearLive } from "@renderer/lib/actions/playback";
import { api } from "@renderer/lib/api";
import { LOGO_URL } from "@shared/urls";

/** One setting per row, label on the left and its control(s) on the right,
 *  never wrapping — the rule this screen follows everywhere so it stays
 *  scannable as it grows. */
function SettingsRow({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="flex flex-nowrap items-center justify-between gap-4">
      <span className="shrink-0 text-sm font-medium text-foreground">{label}</span>
      <div className="flex shrink-0 flex-nowrap items-center gap-2">{children}</div>
    </div>
  );
}

/** The app's settings surface: which screen to project on plus start/stop,
 *  theme, the logo shown when there is nothing else to project, and clearing
 *  whatever is live. Each concern is one row — add the next setting as
 *  another row, not a new screen. */
export function SettingsModal({ onOpenChange, open }: { onOpenChange: (open: boolean) => void; open: boolean }) {
  const t = useT();
  const { displayId, displays, setDisplayId } = useDisplayStore();
  const presentationOpen = useProjectionStore((s) => s.presentationOpen);
  const base = useProjectionStore((s) => s.base);
  const setLogoUrl = useProjectionStore((s) => s.setLogoUrl);
  const theme = useSettingsStore((s) => s.settings["ui.theme"]);
  const logoPath = useSettingsStore((s) => s.settings["logo.path"]);
  const updateSettings = useSettingsStore((s) => s.update);

  async function changeLogo() {
    const path = await api.files.setLogo();
    setLogoUrl(path ? LOGO_URL : null);
  }

  return (
    <Modal onOpenChange={onOpenChange} open={open} size="lg">
      <DialogHeader>
        <Title as="h3">{t("settings.title")}</Title>
      </DialogHeader>
      <DialogContent className="flex flex-col gap-5">
        <SettingsRow label={t("settings.display")}>
          <Select
            className="min-w-56"
            onChange={(e) => void setDisplayId(Number(e.target.value))}
            options={displays.map((d) => ({
              label: `${d.label}${d.primary ? ` ${t("header.primaryDisplay")}` : ""}`,
              value: String(d.id),
            }))}
            size="md"
            value={displayId !== null ? String(displayId) : ""}
          />
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

        <SettingsRow label={t("settings.theme")}>
          <Button
            onClick={() => void updateSettings({ "ui.theme": "dark" })}
            toggled={theme === "dark"}
            variant="secondary"
          >
            <Icon name="moon" /> {t("settings.themeDark")}
          </Button>
          <Button
            onClick={() => void updateSettings({ "ui.theme": "light" })}
            toggled={theme === "light"}
            variant="secondary"
          >
            <Icon name="sun" /> {t("settings.themeLight")}
          </Button>
        </SettingsRow>

        <SettingsRow label={t("settings.logo")}>
          <span className="flex size-9 items-center justify-center overflow-hidden rounded-md border border-border bg-black">
            {logoPath ? (
              <img alt="" className="size-full object-contain" src={LOGO_URL} />
            ) : (
              <Icon className="text-subtle" name="image" />
            )}
          </span>
          <Button onClick={() => void changeLogo()} variant="secondary">
            {t("settings.chooseFile")}
          </Button>
        </SettingsRow>

        <SettingsRow label={t("settings.clearLive")}>
          <Button disabled={base === null} onClick={clearLive} variant="outline">
            <Icon name="close" /> {t("footer.clear")}
          </Button>
        </SettingsRow>
      </DialogContent>
      <DialogFooter>
        <Button onClick={() => onOpenChange(false)} variant="ghost">
          {t("common.cancel")}
        </Button>
      </DialogFooter>
    </Modal>
  );
}
