import { useT } from "@renderer/lib/i18n/i18n-provider";
import { Monitor } from "@renderer/components/ui";
import { OutputView } from "@renderer/components/shared/output-view";
import { selectOutputMemo, useProjectionStore } from "@renderer/stores/projection.store";
import { DeckTransport } from "./deck-transport";

/** What the congregation is seeing, rendered by the same component the
 *  projection window uses — so the monitor can't lie. */
export function LiveMonitor() {
  const t = useT();
  // selectOutputMemo keeps object identity stable across unrelated store
  // updates, so the default comparator is enough here — without it,
  // useSyncExternalStore sees a "new" snapshot every render and loops
  // ("Maximum update depth exceeded").
  const output = useProjectionStore(selectOutputMemo);
  const overlay = useProjectionStore((s) => s.overlay);
  const presentationOpen = useProjectionStore((s) => s.presentationOpen);
  const base = useProjectionStore((s) => s.base);
  const liveDeck = useProjectionStore((s) => s.liveDeck);
  const hasTransport = base?.kind === "deck" && liveDeck !== null;

  const status = !presentationOpen
    ? t("live.disconnected")
    : overlay === "black"
      ? t("status.black")
      : overlay === "logo"
        ? t("status.logo")
        : output.kind === "slide"
          ? t("deck.slideCounter", { current: output.index, total: output.total })
          : base === null
            ? t("live.noSignal")
            : "";

  return (
    <Monitor
      empty={presentationOpen ? t("live.noSignal") : t("live.disconnected")}
      footer={hasTransport ? <DeckTransport /> : undefined}
      label={t("live.title")}
      status={status}
      tone={presentationOpen && base !== null ? "onAir" : "idle"}
    >
      {/* `black` and a logo-less LOGO both render as an empty stage, which is
          exactly right — that IS what the projector is showing. */}
      <OutputView mode="monitor" output={output} />
    </Monitor>
  );
}
