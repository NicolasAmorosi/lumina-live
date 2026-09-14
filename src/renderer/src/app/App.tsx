import { useEffect, useState } from "react";
import { AppShell } from "@renderer/components/pages/layout/AppShell";
import { ProgramsModal } from "@renderer/components/pages/programs/ProgramsModal";
import { SettingsModal } from "@renderer/components/pages/settings/SettingsModal";
import { RemoveAssetConfirm } from "@renderer/components/pages/resources/remove-asset-confirm";
import { useAnyModalOpen } from "@renderer/components/shared/modal";
import { ErrorBoundary } from "@renderer/components/shared/error-boundary";
import { Button, LoadingState, ToastHost } from "@renderer/components/ui";
import { useT } from "@renderer/lib/i18n/i18n-provider";
import { installGlobalErrorHandlers } from "@renderer/lib/global-error-handlers";
import { useProjectionStore } from "@renderer/stores/projection.store";
import { LOGO_URL } from "@shared/urls";
import { useSettingsStore } from "@renderer/stores/settings.store";
import { useDeckStore } from "@renderer/stores/deck.store";
import { useDisplayStore } from "@renderer/stores/display.store";
import { useLibraryStore } from "@renderer/stores/library.store";
import { useUiStore } from "@renderer/stores/ui.store";
import { startProjectionEffects } from "@renderer/effects/projection-sync";
import { startLibrarySyncEffects } from "@renderer/effects/library-sync";
import { useGlobalShortcuts } from "@renderer/lib/hooks/use-global-shortcuts";

/** Control window shell: boot the stores, mount the effect layer, render the
 *  workspace. All layout lives in AppShell, all behaviour in the actions. */
export function App() {
  const t = useT();
  const [programsOpen, setProgramsOpen] = useState(false);
  const [programsInitialMode, setProgramsInitialMode] = useState<{ kind: "create" } | undefined>(
    undefined,
  );
  // The only modal flags that live outside this component: a toast raised
  // from `display.store` (no screen to project on) offers to open Ajustes ->
  // Pantalla, and a toast action has no component tree under it. See
  // `ui.store.ts`.
  const settingsOpen = useUiStore((s) => s.settingsOpen);
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);
  // Same reasoning, and one more: mounted here it exists ONCE. Rendered by
  // `MediaBrowser` it was one dialog per resource tab the operator had
  // visited, since those panels stay mounted after their first visit.
  const removeAssetConfirmId = useUiStore((s) => s.removeAssetConfirmId);
  const setRemoveAssetConfirmId = useUiStore((s) => s.setRemoveAssetConfirmId);
  const loadSettings = useSettingsStore((s) => s.load);
  const logoPath = useSettingsStore((s) => s.settings["logo.path"]);
  const setLogoUrl = useProjectionStore((s) => s.setLogoUrl);
  const transitionStyle = useSettingsStore((s) => s.settings["projection.transition.style"]);
  const transitionDurationMs = useSettingsStore((s) => s.settings["projection.transition.durationMs"]);
  const setTransitionSettings = useProjectionStore((s) => s.setTransitionSettings);

  useGlobalShortcuts(useAnyModalOpen());

  useEffect(() => installGlobalErrorHandlers(), []);

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
    const stopProjectionEffects = startProjectionEffects();
    const stopLibrarySync = startLibrarySyncEffects();
    return () => {
      stopProjectionEffects();
      stopLibrarySync();
    };
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
      {/* Scoped to the workspace, not to the whole app: the toast host stays
          mounted outside it, so whatever recovery message the operator needs
          is still on screen even with the shell replaced by its fallback. */}
      <ErrorBoundary
        fallback={({ error, reset }) => (
          <div className="flex h-full items-center justify-center p-6">
            <LoadingState
              action={
                <div className="flex gap-2">
                  <Button onClick={reset} size="sm" variant="primary">
                    {t("common.retry")}
                  </Button>
                  <Button onClick={() => window.location.reload()} size="sm" variant="outline">
                    {t("app.reload")}
                  </Button>
                </div>
              }
              hint={error.message}
              icon="alert"
              surface="panel"
              title={t("app.crashed")}
              tone="failed"
            />
          </div>
        )}
      >
        <AppShell
          onOpenPrograms={(opts) => {
            setProgramsInitialMode(opts?.mode === "create" ? { kind: "create" } : undefined);
            setProgramsOpen(true);
          }}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      </ErrorBoundary>
      <ProgramsModal initialMode={programsInitialMode} onOpenChange={setProgramsOpen} open={programsOpen} />
      <SettingsModal onOpenChange={setSettingsOpen} open={settingsOpen} />
      <RemoveAssetConfirm
        assetId={removeAssetConfirmId}
        onOpenChange={(open) => {
          if (!open) setRemoveAssetConfirmId(null);
        }}
      />
      <ToastHost />
    </>
  );
}
