import { useEffect } from "react";
import { Button, LoadingState } from "@renderer/components/ui";
import { useT } from "@renderer/lib/i18n/i18n-provider";
import { api } from "@renderer/lib/api";
import { toast } from "@renderer/lib/toast";
import type { AssetKind } from "@shared/constants";
import type { MediaConversionState } from "@shared/types/media";

/**
 * A video or audio that cannot play until main finishes converting it, in the
 * shape both the PREVIEW stage and the slide panel need — one component, one
 * wording, the same rule `DeckConversionStatus` follows for decks.
 *
 * Mounting it is the signal that the operator is looking at this file, so it
 * jumps the queue: a folder of fifty AVIs converting in the background must
 * not make the one about to be projected wait for the other forty-nine.
 */
export function MediaConversionStatus({
  assetId,
  kind,
  state,
  surface = "panel",
}: {
  assetId: number;
  kind: AssetKind;
  state: MediaConversionState;
  surface?: "stage" | "panel";
}) {
  const t = useT();
  const failed = state.status === "failed";

  useEffect(() => {
    if (!failed) void api.conversion.prioritize(assetId).catch(() => undefined);
  }, [assetId, failed]);

  if (state.status === "failed") {
    return (
      <LoadingState
        action={
          <Button
            onClick={() => void api.conversion.retry(assetId).catch(() => toast.danger(t("conversion.retryError")))}
            size="xs"
            variant="outline"
          >
            {t("conversion.retry")}
          </Button>
        }
        hint={t(`conversion.errors.${state.errorCode}`)}
        icon="alert"
        surface={surface}
        title={t("conversion.failed")}
        tone="failed"
      />
    );
  }

  const progress = state.status === "converting" ? state.progress : null;
  return (
    <LoadingState
      hint={t("conversion.hint")}
      icon={kind === "audio" ? "audio" : "video"}
      progress={progress}
      surface={surface}
      title={
        state.status === "queued"
          ? t("conversion.queued")
          : progress === null
            ? t("conversion.starting")
            : t("conversion.converting", { percent: Math.round(progress * 100) })
      }
      tone={state.status === "queued" ? "queued" : "busy"}
    />
  );
}
