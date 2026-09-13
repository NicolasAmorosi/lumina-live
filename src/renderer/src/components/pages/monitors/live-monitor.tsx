import { useMemo } from "react";
import { useT } from "@renderer/lib/i18n/i18n-provider";
import { Monitor } from "@renderer/components/ui";
import { OutputView } from "@renderer/components/shared/output-view";
import { selectOutputMemo, useProjectionStore } from "@renderer/stores/projection.store";
import { mediaTargetKey } from "@shared/types/projection";

const VIDEO_TARGET_KEY = mediaTargetKey({ kind: "video" });

/** What the congregation is seeing, rendered by the same component the
 *  projection window uses — so the monitor can't lie. Its status text (NEGRO,
 *  LOGO, slide counter…) lives in the column header, not here — see
 *  `useLiveStatus` in `MonitorsColumn.tsx`. The deck transport used to render
 *  as this monitor's footer; it's a sibling row in `MonitorsColumn` now so a
 *  deck's controls can never shrink the stage itself — see `Monitor`.
 *
 * A live video actually plays here too, not just a frozen frame — it's a
 * second, independently decoding `<video>` (this window's own process can't
 * share the projector's decoder), kept in sync via `liveVideoStatus`, the
 * same `mediaStatus` report the media transport bar already reads. See
 * `OutputView`'s `LiveVideo` for the drift correction itself. */
export function LiveMonitor() {
  const t = useT();
  // selectOutputMemo keeps object identity stable across unrelated store
  // updates, so the default comparator is enough here — without it,
  // useSyncExternalStore sees a "new" snapshot every render and loops
  // ("Maximum update depth exceeded").
  const output = useProjectionStore(selectOutputMemo);
  const presentationOpen = useProjectionStore((s) => s.presentationOpen);
  const liveVideoStatus = useProjectionStore((s) => s.mediaStatus[VIDEO_TARGET_KEY] ?? null);
  // The record, not a derived array: a selector returning a fresh array on
  // every call makes `useSyncExternalStore` see a new snapshot each render and
  // loop. `mediaErrors` only changes when the projector actually reports
  // something, so the memo below runs approximately never.
  const mediaErrors = useProjectionStore((s) => s.mediaErrors);
  const reportedErrorUrls = useMemo(
    () => Object.values(mediaErrors).map((error) => error.url),
    [mediaErrors],
  );

  return (
    <Monitor empty={presentationOpen ? t("live.noSignal") : t("live.disconnected")}>
      {/* `black` and a logo-less LOGO both render as an empty stage, which is
          exactly right — that IS what the projector is showing. A failure is
          the one case where an empty stage would NOT be the truth, which is
          what `errorLabel`/`reportedErrorUrls` exist to say out loud. */}
      <OutputView
        errorLabel={t("media.loadError")}
        liveVideoStatus={liveVideoStatus}
        mode="monitor"
        output={output}
        reportedErrorUrls={reportedErrorUrls}
      />
    </Monitor>
  );
}
