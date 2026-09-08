import { useT } from "@renderer/lib/i18n/i18n-provider";
import { Badge, Button, Icon, IconButton, Toolbar } from "@renderer/components/ui";
import { useServiceStore } from "@renderer/stores/service.store";
import { useProjectionStore } from "@renderer/stores/projection.store";
import { useDisplayStore } from "@renderer/stores/display.store";
import { goLive } from "@renderer/lib/actions/playback";
import { usePreviewContent } from "@renderer/lib/hooks/use-preview";
import type { OverlayState } from "@shared/types/projection";

type TopBarProps = { onOpenServices: () => void; onOpenSettings: () => void };

/**
 * Chrome bar, laid out in the same three columns as the workspace below it so
 * each group of controls sits exactly above the column it acts on:
 *
 *   col 1 (schedule/resources) — settings, saved services, current service
 *   col 2 (slides)             — EN VIVO: preview -> live, right now
 *   col 3 (monitors)           — NEGRO / LOGO / VIVO: what the projector shows
 *
 * Screen selection, theme and logo all live in Settings now — this bar only
 * ever changes what is on the projector, never how the app is configured.
 */
export function TopBar({ onOpenServices, onOpenSettings }: TopBarProps) {
  const t = useT();
  const serviceName = useServiceStore((s) => s.currentServiceName);
  const itemCount = useServiceStore((s) => s.items.length);
  const overlay = useProjectionStore((s) => s.overlay);
  const setOverlay = useProjectionStore((s) => s.setOverlay);
  const previewContent = usePreviewContent();

  // The projection window never opens on its own any more — the first tap on
  // NEGRO, LOGO or EN VIVO is what turns the projector on, whichever comes
  // first.
  function setOverlayAndOpen(next: OverlayState) {
    void useDisplayStore.getState().openIfNeeded();
    setOverlay(next);
  }

  return (
    <Toolbar className="grid grid-cols-3 items-center">
      <div className="flex items-center gap-1.5">
        <IconButton onClick={onOpenSettings} title={t("settings.title")} variant="ghost">
          <Icon name="settings" />
        </IconButton>
        <Button onClick={onOpenServices} size="sm" variant="ghost">
          <Icon name="save" /> {t("services.title")}
        </Button>
        <Badge variant="blue">{serviceName}</Badge>
        <Badge>{t("schedule.itemCount", { count: itemCount })}</Badge>
      </div>

      <div className="flex items-center justify-end">
        <Button disabled={previewContent === null} onClick={() => void goLive()} variant="live">
          <Icon name="play" /> {t("actions.goLive")}
        </Button>
      </div>

      <div className="flex items-center justify-end gap-1.5">
        <Button
          className="w-24"
          onClick={() => setOverlayAndOpen("logo")}
          size="sm"
          toggled={overlay === "logo"}
          variant="secondary"
        >
          <Icon name="image" /> {t("footer.logo")}
        </Button>
        <Button
          className="w-24"
          onClick={() => setOverlayAndOpen("black")}
          size="sm"
          toggled={overlay === "black"}
          variant="secondary"
        >
          <Icon name="stop" /> {t("footer.black")}
        </Button>
        <Button
          className="w-24"
          onClick={() => setOverlayAndOpen("none")}
          size="sm"
          toggled={overlay === "none"}
          variant="secondary"
        >
          <Icon name="play" /> {t("footer.live")}
        </Button>
      </div>
    </Toolbar>
  );
}
