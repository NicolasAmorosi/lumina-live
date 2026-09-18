import { useT } from "@renderer/lib/i18n/i18n-provider";
import { Badge } from "@renderer/components/ui";
import { PanelBody, PanelHeader } from "@renderer/components/shared/panel";
import { selectOutputMemo, useProjectionStore } from "@renderer/stores/projection.store";
import { useLiveHeading } from "@renderer/lib/hooks/use-live";
import { cn } from "@renderer/lib/utils";
import { LiveMonitor } from "./live-monitor";
import { LiveContentGrid } from "./live-content-grid";
import { LiveMediaPanel } from "./live-media-panel";
import { DeckTransport } from "./deck-transport";
import { VerseTransport } from "./verse-transport";

/**
 * EasyWorship's right-hand column: a header matching the other two columns'
 * (same height, "EN VIVO" plus a blinking dot exactly while something is
 * actually going out to the projector), the LIVE monitor, and below it the
 * live equivalent of the centre column's grid — a deck's slides or a
 * passage's verses, whichever is on air. The preview monitor used to live
 * here too; it is pinned in the centre column now, next to what it previews.
 *
 * The monitor itself is a bare stage (`components/ui/monitor.tsx`), so all
 * of its former status text (NEGRO/LOGO/desconectado) lives here in the
 * header instead — see `useLiveStatus`. The slide counter used to live here
 * too; it's redundant with `DeckTransport`'s own counter and the highlighted
 * tile in `LiveContentGrid`, so it was dropped rather than shown three times.
 */
function useLiveStatus(): string {
  const t = useT();
  const presentationOpen = useProjectionStore((s) => s.presentationOpen);
  // Read off the SAME value the monitor renders, never a second reading of
  // `overlay`/`base`: this badge used to re-derive the precedence by hand and
  // got it wrong for the one case the two disagree on. With nothing selected
  // and no overlay, `selectOutputWithoutUnderlay` falls back to the logo — so
  // the stage showed the logo while the badge beside it said "Sin señal".
  // A badge that contradicts the stage it labels is the monitor lying to the
  // operator, which is the one thing this column may never do.
  // `.kind` and not the whole output: a string is comparable by `Object.is`,
  // so this subscription only wakes the column when the badge would actually
  // change — not on every slide advance. `selectOutputMemo` makes the call
  // inside the selector free.
  const outputKind = useProjectionStore((s) => selectOutputMemo(s).kind);

  if (!presentationOpen) return t("live.disconnected");
  if (outputKind === "black") return t("status.black");
  if (outputKind === "logo") return t("status.logo");
  return "";
}

export function MonitorsColumn() {
  const t = useT();
  const presentationOpen = useProjectionStore((s) => s.presentationOpen);
  const overlay = useProjectionStore((s) => s.overlay);
  const base = useProjectionStore((s) => s.base);
  const heading = useLiveHeading();
  const status = useLiveStatus();

  const broadcasting = presentationOpen && overlay === "none" && base !== null;

  return (
    <>
      <PanelHeader
        actions={
          <>
            {heading ? (
              <Badge className="min-w-0 flex-1 truncate" variant="blue">
                {heading}
              </Badge>
            ) : null}
            {status ? (
              <Badge className="shrink-0" variant="neutral">
                {status}
              </Badge>
            ) : null}
          </>
        }
        title={
          <span className="flex items-center gap-1.5">
            {broadcasting ? (
              <span className="size-2 animate-pulse rounded-full bg-on-air" />
            ) : null}
            {t("live.title")}
          </span>
        }
      />
      <div className="grid min-h-0 flex-1 grid-rows-[auto_auto_auto_minmax(0,1fr)] gap-3 p-3">
        <LiveMonitor />
        {/* The deck and verse transports are the only other rows sized
            `auto` — a service with neither a deck nor a verse live looks
            exactly like it did before either existed (each renders `null`,
            and they're mutually exclusive since `base` can't be both kinds
            at once). They're siblings of the monitor, never its footer, so
            neither can shrink the stage itself — see `Monitor`. The media
            panel lives below, inside the scrolling body, not as its own
            `auto` row: an unbounded number of audio tracks must never
            compete with the monitor for height, only grow the scroll area. */}
        <DeckTransport />
        <VerseTransport />
        <PanelBody className="flex flex-col gap-3 p-1.5">
          <LiveMediaPanel />
          <div className={cn("flex flex-1 flex-col", base === null && "items-center justify-center")}>
            <LiveContentGrid />
          </div>
        </PanelBody>
      </div>
    </>
  );
}
