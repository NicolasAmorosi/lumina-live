import { useT } from "@renderer/lib/i18n/i18n-provider";
import { Button, Icon, Select, Tooltip, VolumeControl } from "@renderer/components/ui";
import { useDisplayStore } from "@renderer/stores/display.store";
import { useProjectionStore } from "@renderer/stores/projection.store";
import { useSettingsStore } from "@renderer/stores/settings.store";
import { clearLive } from "@renderer/lib/actions/playback";
import { api } from "@renderer/lib/api";
import { toast } from "@renderer/lib/toast";
import { IpcError } from "@shared/ipc/result";
import { LOGO_URL } from "@shared/urls";
import type { TransitionStyle } from "@shared/types/projection";
import { SettingsGroup, SettingsRow } from "../settings-row";

const TRANSITION_STYLE_LABEL_KEYS: Record<TransitionStyle, string> = {
  none: "settings.transitionStyles.none",
  crossfade: "settings.transitionStyles.crossfade",
  "fade-through-black": "settings.transitionStyles.fadeThroughBlack",
};

const TRANSITION_DURATION_OPTIONS = [150, 300, 600] as const;

/** Everything about what the projector shows: which screen, the fallback
 *  logo, and clearing whatever is currently live. */
export function ProjectionSection() {
  const t = useT();
  const { displayId, displays, setDisplayId } = useDisplayStore();
  const presentationOpen = useProjectionStore((s) => s.presentationOpen);
  const base = useProjectionStore((s) => s.base);
  const logoPath = useSettingsStore((s) => s.settings["logo.path"]);
  const transitionStyle = useSettingsStore((s) => s.settings["projection.transition.style"]);
  const transitionDurationMs = useSettingsStore((s) => s.settings["projection.transition.durationMs"]);
  const startVolume = useSettingsStore((s) => s.settings["media.volume"]);
  const updateSettings = useSettingsStore((s) => s.update);

  // The URL carries the logo's own path as a cache-buster: it's the same
  // "worship://logo" host for every logo, so without something in the URL
  // that actually changes when the file changes, the <img> keeps showing the
  // previous image after picking a new one (React sees an unchanged `src`
  // and never re-fetches).
  const logoUrl = logoPath ? `${LOGO_URL}?p=${encodeURIComponent(logoPath)}` : null;

  async function changeLogo() {
    try {
      await api.files.setLogo();
    } catch (error) {
      // Main refuses an image it cannot decode rather than persisting one that
      // would leave LOGO black on the projector, so there is nothing to
      // reload: the previous logo is still the one in the database.
      if (error instanceof IpcError && error.code === "LOGO_UNREADABLE") {
        toast.danger(t("settings.logoUnreadable"));
        return;
      }
      throw error;
    }
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
          <Tooltip content={t("settings.logoFormats")} floating>
            <Icon className="text-subtle" name="help" />
          </Tooltip>
          <Button onClick={() => void changeLogo()} variant="secondary">
            {t("settings.chooseFile")}
          </Button>
        </SettingsRow>
        <div className="flex h-64 items-center justify-center overflow-hidden bg-surface px-4 py-3">
          {logoUrl ? (
            <img alt="" className="h-full max-w-full object-contain" src={logoUrl} />
          ) : (
            <Icon className="text-subtle" name="image" />
          )}
        </div>
      </SettingsGroup>

      <SettingsGroup title={t("settings.groups.liveContent")}>
        <SettingsRow description={t("settings.clearLiveDesc")} label={t("settings.clearLive")}>
          <Button disabled={base === null} onClick={clearLive} variant="outline">
            <Icon name="close" /> {t("footer.clear")}
          </Button>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title={t("settings.groups.audio")}>
        <SettingsRow description={t("settings.startVolumeDesc")} label={t("settings.startVolume")}>
          <span className="w-10 text-right text-sm tabular-nums text-muted-foreground">
            {Math.round(startVolume * 100)}%
          </span>
          <VolumeControl
            label={t("settings.startVolume")}
            muteLabel={startVolume === 0 ? t("media.unmute") : t("media.mute")}
            onChange={(volume) => void updateSettings({ "media.volume": volume })}
            value={startVolume}
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title={t("settings.groups.transition")}>
        <SettingsRow description={t("settings.transitionStyleDesc")} label={t("settings.transitionStyle")}>
          <Select
            className="min-w-48"
            onChange={(value) => void updateSettings({ "projection.transition.style": value as TransitionStyle })}
            options={(Object.keys(TRANSITION_STYLE_LABEL_KEYS) as TransitionStyle[]).map((style) => ({
              label: t(TRANSITION_STYLE_LABEL_KEYS[style]),
              value: style,
            }))}
            size="md"
            value={transitionStyle}
          />
        </SettingsRow>
        <SettingsRow description={t("settings.transitionDurationDesc")} label={t("settings.transitionDuration")}>
          <Select
            className="min-w-40"
            disabled={transitionStyle === "none"}
            onChange={(value) => void updateSettings({ "projection.transition.durationMs": Number(value) })}
            options={TRANSITION_DURATION_OPTIONS.map((ms) => ({
              label: t(`settings.transitionDurationOptions.${ms}`),
              value: String(ms),
            }))}
            size="md"
            value={String(transitionDurationMs)}
          />
        </SettingsRow>
      </SettingsGroup>
    </div>
  );
}
