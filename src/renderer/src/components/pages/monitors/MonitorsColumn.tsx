import { useT } from "@renderer/lib/i18n/i18n-provider";
import { Badge } from "@renderer/components/ui";
import { PanelBody, PanelHeader } from "@renderer/components/shared/panel";
import { useProjectionStore } from "@renderer/stores/projection.store";
import { useLiveHeading } from "@renderer/lib/hooks/use-live";
import { cn } from "@renderer/lib/utils";
import { LiveMonitor } from "./live-monitor";
import { LiveContentGrid } from "./live-content-grid";

/**
 * EasyWorship's right-hand column: a header matching the other two columns'
 * (same height, "EN VIVO" plus a blinking dot exactly while something is
 * actually going out to the projector), the LIVE monitor, and below it the
 * live equivalent of the centre column's grid — a deck's slides or a
 * passage's verses, whichever is on air. The preview monitor used to live
 * here too; it is pinned in the centre column now, next to what it previews.
 */
export function MonitorsColumn() {
  const t = useT();
  const presentationOpen = useProjectionStore((s) => s.presentationOpen);
  const overlay = useProjectionStore((s) => s.overlay);
  const base = useProjectionStore((s) => s.base);
  const heading = useLiveHeading();

  const broadcasting = presentationOpen && overlay === "none" && base !== null;

  return (
    <>
      <PanelHeader
        actions={heading ? <Badge variant="blue">{heading}</Badge> : undefined}
        title={
          <span className="flex items-center gap-1.5">
            {broadcasting ? (
              <span className="size-2 animate-pulse rounded-full bg-on-air" />
            ) : null}
            {t("live.title")}
          </span>
        }
      />
      <div className="grid min-h-0 flex-1 grid-rows-2 gap-2 p-2">
        <LiveMonitor />
        <PanelBody className={cn("flex flex-col", base === null && "items-center justify-center")}>
          <LiveContentGrid />
        </PanelBody>
      </div>
    </>
  );
}
