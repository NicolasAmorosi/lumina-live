import { useEffect, useState } from "react";
import { AppShell } from "@renderer/components/pages/layout/AppShell";
import { ProgramsModal } from "@renderer/components/pages/programs/ProgramsModal";
import { SettingsModal } from "@renderer/components/pages/settings/SettingsModal";
import { useAnyModalOpen } from "@renderer/components/shared/modal";
import { ToastHost } from "@renderer/components/ui";
import { useProjectionStore } from "@renderer/stores/projection.store";
import { LOGO_URL } from "@shared/urls";
import { useSettingsStore } from "@renderer/stores/settings.store";
import { useDeckStore } from "@renderer/stores/deck.store";
import { useDisplayStore } from "@renderer/stores/display.store";
import { useLibraryStore } from "@renderer/stores/library.store";
import { startProjectionEffects } from "@renderer/effects/projection-sync";
import { useGlobalShortcuts } from "@renderer/lib/hooks/use-global-shortcuts";

/** Control window shell: boot the stores, mount the effect layer, render the
 *  workspace. All layout lives in AppShell, all behaviour in the actions. */
export function App() {
  const [programsOpen, setProgramsOpen] = useState(false);
  const [programsInitialMode, setProgramsInitialMode] = useState<{ kind: "create" } | undefined>(
    undefined,
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const loadSettings = useSettingsStore((s) => s.load);
  const logoPath = useSettingsStore((s) => s.settings["logo.path"]);
  const setLogoUrl = useProjectionStore((s) => s.setLogoUrl);
  const transitionStyle = useSettingsStore((s) => s.settings["projection.transition.style"]);
  const transitionDurationMs = useSettingsStore((s) => s.settings["projection.transition.durationMs"]);
  const setTransitionSettings = useProjectionStore((s) => s.setTransitionSettings);

  useGlobalShortcuts(useAnyModalOpen());

  useEffect(() => {
    void (async () => {
      await loadSettings();
      const { settings } = useSettingsStore.getState();
      useLibraryStore
        .getState()
        .hydrateActiveViews(settings["library.activeView"], settings["library.linkedFolders"]);
      // Nothing opens the projection window on launch any more — it was
      // unreliable. The operator's first tap on NEGRO, LOGO or EN VIVO opens
      // it on demand (see display.store's `openIfNeeded`).
      await useDisplayStore.getState().load();
    })();
    void useDeckStore.getState().loadEnvironment();
    return startProjectionEffects();
  }, [loadSettings]);

  useEffect(() => {
    // The path itself is the cache-buster: `worship://logo` is always the
    // same host, so without something in the URL that changes along with the
    // file, the projector's <img> would keep the previous logo cached.
    setLogoUrl(logoPath ? `${LOGO_URL}?p=${encodeURIComponent(logoPath)}` : null);
  }, [logoPath, setLogoUrl]);

  // Mirrors the projection settings into the store the same way the logo
  // does above — `selectOutput` reads them off `projection.store`, not
  // straight from settings, so the projection window's input stays a single
  // self-contained value with no settings dependency of its own.
  useEffect(() => {
    setTransitionSettings(transitionStyle, transitionDurationMs);
  }, [transitionStyle, transitionDurationMs, setTransitionSettings]);

  return (
    <>
      <AppShell
        onOpenPrograms={(opts) => {
          setProgramsInitialMode(opts?.mode === "create" ? { kind: "create" } : undefined);
          setProgramsOpen(true);
        }}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <ProgramsModal initialMode={programsInitialMode} onOpenChange={setProgramsOpen} open={programsOpen} />
      <SettingsModal onOpenChange={setSettingsOpen} open={settingsOpen} />
      <ToastHost />
    </>
  );
}
