import { useT } from "@renderer/lib/i18n/i18n-provider";
import { Monitor } from "@renderer/components/ui";
import { OutputView } from "@renderer/components/shared/output-view";
import { selectOutputMemo, useProjectionStore } from "@renderer/stores/projection.store";

/** What the congregation is seeing, rendered by the same component the
 *  projection window uses — so the monitor can't lie. Its status text (NEGRO,
 *  LOGO, slide counter…) lives in the column header, not here — see
 *  `useLiveStatus` in `MonitorsColumn.tsx`. The deck transport used to render
 *  as this monitor's footer; it's a sibling row in `MonitorsColumn` now so a
 *  deck's controls can never shrink the stage itself — see `Monitor`. */
export function LiveMonitor() {
  const t = useT();
  // selectOutputMemo keeps object identity stable across unrelated store
  // updates, so the default comparator is enough here — without it,
  // useSyncExternalStore sees a "new" snapshot every render and loops
  // ("Maximum update depth exceeded").
  const output = useProjectionStore(selectOutputMemo);
  const presentationOpen = useProjectionStore((s) => s.presentationOpen);

  return (
    <Monitor empty={presentationOpen ? t("live.noSignal") : t("live.disconnected")}>
      {/* `black` and a logo-less LOGO both render as an empty stage, which is
          exactly right — that IS what the projector is showing. */}
      <OutputView mode="monitor" output={output} />
    </Monitor>
  );
}
