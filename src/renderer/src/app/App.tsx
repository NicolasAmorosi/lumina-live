import { useEffect, useState } from "react";
import { AppShell } from "@renderer/components/pages/layout/AppShell";
import { ServicesModal } from "@renderer/components/pages/services/ServicesModal";
import { SettingsModal } from "@renderer/components/pages/settings/SettingsModal";
import { useProjectionStore } from "@renderer/stores/projection.store";
import { useSettingsStore } from "@renderer/stores/settings.store";
import { useDeckStore } from "@renderer/stores/deck.store";
import { useDisplayStore } from "@renderer/stores/display.store";
import { startProjectionEffects } from "@renderer/effects/projection-sync";
import { useGlobalShortcuts } from "@renderer/lib/hooks/use-global-shortcuts";

/** Control window shell: boot the stores, mount the effect layer, render the
 *  workspace. All layout lives in AppShell, all behaviour in the actions. */
export function App() {
  const [servicesOpen, setServicesOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const loadSettings = useSettingsStore((s) => s.load);
  const logoPath = useSettingsStore((s) => s.settings["logo.path"]);
  const setLogoUrl = useProjectionStore((s) => s.setLogoUrl);

  useGlobalShortcuts(servicesOpen || settingsOpen);

  useEffect(() => {
    void (async () => {
      await loadSettings();
      // Nothing opens the projection window on launch any more — it was
      // unreliable. The operator's first tap on NEGRO, LOGO or EN VIVO opens
      // it on demand (see display.store's `openIfNeeded`).
      await useDisplayStore.getState().load();
    })();
    void useDeckStore.getState().loadEnvironment();
    return startProjectionEffects();
  }, [loadSettings]);

  useEffect(() => {
    setLogoUrl(logoPath ? "worship://logo" : null);
  }, [logoPath, setLogoUrl]);

  return (
    <>
      <AppShell onOpenServices={() => setServicesOpen(true)} onOpenSettings={() => setSettingsOpen(true)} />
      <ServicesModal onOpenChange={setServicesOpen} open={servicesOpen} />
      <SettingsModal onOpenChange={setSettingsOpen} open={settingsOpen} />
    </>
  );
}
