import { useT } from "@renderer/lib/i18n/i18n-provider";
import { PanelBody, PanelHeader } from "@renderer/components/shared/panel";
import { selectOutputMemo, useProjectionStore } from "@renderer/stores/projection.store";
import { cn } from "@renderer/lib/utils";

export function LiveMonitorPanel() {
  const t = useT();
  // selectOutputMemo keeps object identity stable across unrelated store
  // updates, so the default comparator is enough here — without it,
  // useSyncExternalStore sees a "new" snapshot every render and loops
  // ("Maximum update depth exceeded").
  const output = useProjectionStore(selectOutputMemo);
  const presentationOpen = useProjectionStore((s) => s.presentationOpen);

  return (
    <>
      <PanelHeader title={t("live.title")} />
      <PanelBody className="flex items-center justify-center bg-black p-2">
        {output.kind === "black" ? (
          <div className="size-full bg-black" />
        ) : output.kind === "image" || output.kind === "logo" ? (
          output.url ? <img alt="" className="max-h-full max-w-full object-contain" src={output.url} /> : null
        ) : output.kind === "video" ? (
          <video className="max-h-full max-w-full" muted src={output.url} />
        ) : output.kind === "bible" ? (
          <div className="text-center text-white">
            <p className="text-sm">{output.text}</p>
            <p className="mt-1 text-xs text-white/70">{output.reference}</p>
          </div>
        ) : output.kind === "text" ? (
          <p className="text-center text-sm text-white">{output.body}</p>
        ) : output.kind === "slide" ? (
          <div className="flex size-full flex-col items-center justify-center gap-1">
            <img alt="" className="max-h-full max-w-full object-contain" src={output.url} />
            <span className="shrink-0 text-xs text-white/70">
              {t("deck.slideCounter", { current: output.index, total: output.total })}
            </span>
          </div>
        ) : null}
      </PanelBody>
      <span
        className={cn(
          "block shrink-0 border-t border-border py-1.5 text-center text-xs",
          presentationOpen ? "text-success" : "text-subtle",
        )}
      >
        {presentationOpen ? t("live.title") : t("live.disconnected")}
      </span>
    </>
  );
}
