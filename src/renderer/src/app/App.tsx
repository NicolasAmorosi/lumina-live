import { useEffect, useState } from "react";
import { useT } from "@renderer/lib/i18n/i18n-provider";
import { Button, IconButton, Select, Tabs } from "@renderer/components/ui";
import { Panel } from "@renderer/components/shared/panel";
import { PlaylistPanel } from "@renderer/components/pages/playlist/PlaylistPanel";
import { MediaLibraryPanel } from "@renderer/components/pages/media-library/MediaLibraryPanel";
import { BiblePanel } from "@renderer/components/pages/bible/BiblePanel";
import { PreviewPanel } from "@renderer/components/pages/preview/PreviewPanel";
import { LiveMonitorPanel } from "@renderer/components/pages/live-monitor/LiveMonitorPanel";
import { ServicesModal } from "@renderer/components/pages/services/ServicesModal";
import { useProjectionStore } from "@renderer/stores/projection.store";
import { useSettingsStore } from "@renderer/stores/settings.store";
import { api } from "@renderer/lib/api";
import type { DisplayInfo } from "@shared/types/display";
import { startProjectionEffects } from "@renderer/effects/projection-sync";
import { useDeckStore } from "@renderer/stores/deck.store";
import { toggleOverlay } from "@renderer/lib/actions/playback";
import { useGlobalShortcuts } from "@renderer/lib/hooks/use-global-shortcuts";

export function App() {
  const t = useT();
  const [displays, setDisplays] = useState<DisplayInfo[]>([]);
  const [displayId, setDisplayId] = useState<number | null>(null);
  const [centerTab, setCenterTab] = useState<"preview" | "bible">("preview");
  const [servicesOpen, setServicesOpen] = useState(false);

  const { overlay, presentationOpen, setLogoUrl, setPresentationOpen } = useProjectionStore();
  const loadSettings = useSettingsStore((s) => s.load);
  const settings = useSettingsStore((s) => s.settings);

  useGlobalShortcuts(centerTab, servicesOpen);

  useEffect(() => {
    void loadSettings();
    void useDeckStore.getState().loadEnvironment();
    void api.displays.list().then((list) => {
      setDisplays(list);
      const nonPrimary = list.find((d) => !d.primary);
      setDisplayId((nonPrimary ?? list[0])?.id ?? null);
    });
    const stop = startProjectionEffects();
    return stop;
  }, [loadSettings]);

  useEffect(() => {
    setLogoUrl(settings["logo.path"] ? "worship://logo" : null);
  }, [settings, setLogoUrl]);

  async function openDisplay() {
    if (displayId === null) return;
    await api.projection.open(displayId);
    setPresentationOpen(true);
  }
  async function closeDisplay() {
    await api.projection.close();
    setPresentationOpen(false);
  }
  async function changeLogo() {
    const path = await api.files.setLogo();
    setLogoUrl(path ? "worship://logo" : null);
  }

  return (
    <div className="flex h-screen flex-col">
      <header className="flex shrink-0 items-center justify-between border-b border-border bg-surface px-3 py-2">
        <h1 className="text-sm font-semibold">{t("app.title")}</h1>
        <div className="flex items-center gap-2">
          <Select
            onChange={(e) => setDisplayId(Number(e.target.value))}
            options={displays.map((d) => ({ label: `${d.label}${d.primary ? " (principal)" : ""}`, value: String(d.id) }))}
            size="sm"
            value={displayId !== null ? String(displayId) : ""}
          />
          {presentationOpen ? (
            <Button onClick={() => void closeDisplay()} size="sm" variant="secondary">
              {t("header.closeDisplay")}
            </Button>
          ) : (
            <Button onClick={() => void openDisplay()} size="sm">
              {t("header.openDisplay")}
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => setServicesOpen(true)} size="sm" variant="ghost">
            {t("services.title")}
          </Button>
          <Button onClick={() => void changeLogo()} size="sm" variant="ghost">
            {t("header.changeLogo")}
          </Button>
          <IconButton
            onClick={() =>
              void useSettingsStore
                .getState()
                .update({ "ui.theme": settings["ui.theme"] === "dark" ? "light" : "dark" })
            }
          >
            {settings["ui.theme"] === "dark" ? "☀" : "☾"}
          </IconButton>
        </div>
      </header>

      <main className="grid min-h-0 flex-1 grid-cols-[280px_1fr_240px] divide-x divide-border">
        <div className="grid min-h-0 grid-rows-2 divide-y divide-border">
          <Panel>
            <PlaylistPanel />
          </Panel>
          <Panel>
            <MediaLibraryPanel />
          </Panel>
        </div>

        <Panel>
          <Tabs
            onChange={setCenterTab}
            tabs={[
              { value: "preview", label: t("preview.title"), icon: "display" },
              { value: "bible", label: t("bible.title"), icon: "bible" },
            ]}
            value={centerTab}
          />
          {centerTab === "preview" ? <PreviewPanel /> : <BiblePanel />}
        </Panel>

        <Panel>
          <LiveMonitorPanel />
        </Panel>
      </main>

      <footer className="flex shrink-0 items-center justify-center gap-3 border-t border-border bg-surface px-3 py-2">
        <Button onClick={() => toggleOverlay("black")} size="lg" toggled={overlay === "black"} variant="secondary">
          {t("footer.black")}
        </Button>
        <Button onClick={() => toggleOverlay("logo")} size="lg" toggled={overlay === "logo"} variant="secondary">
          {t("footer.logo")}
        </Button>
      </footer>

      <ServicesModal onOpenChange={setServicesOpen} open={servicesOpen} />
    </div>
  );
}
