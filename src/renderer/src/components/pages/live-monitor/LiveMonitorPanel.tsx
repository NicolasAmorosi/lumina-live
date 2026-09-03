import { useShallow } from "zustand/react/shallow";
import { useT } from "@renderer/lib/i18n/i18n-provider";
import { PanelBody, PanelHeader } from "@renderer/components/shared/panel";
import { selectOutput, useProjectionStore } from "@renderer/stores/projection.store";
import { cn } from "@renderer/lib/utils";

export function LiveMonitorPanel() {
  const t = useT();
  // selectOutput returns a fresh object every call — without a shallow
  // comparator, useSyncExternalStore sees a "new" snapshot on every render
  // and re-renders forever ("Maximum update depth exceeded").
  const output = useProjectionStore(useShallow(selectOutput));
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
        ) : (
          <p className="text-xs text-white/50">PPT</p>
        )}
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
