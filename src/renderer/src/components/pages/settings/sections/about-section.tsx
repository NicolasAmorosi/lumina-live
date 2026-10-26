import { useEffect, useState } from "react";
import { useI18n, type Translate } from "@renderer/lib/i18n/i18n-provider";
import { Badge, BrandMark, Button, Caption, FieldGroup, FieldRow, Wordmark } from "@renderer/components/ui";
import { api } from "@renderer/lib/api";
import { onIpc } from "@renderer/lib/ipc";
import { toast } from "@renderer/lib/toast";
import type { Locale } from "@shared/types/settings";
import { canCheck, type UpdateStatus } from "@shared/types/updates";

/** Main's update status, kept current. Subscribed before asking, and the
 *  answer never overwrites an event that arrived first. */
function useUpdateStatus(): UpdateStatus | null {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  useEffect(() => {
    const stop = onIpc("update-status", setStatus);
    api.updates
      .getStatus()
      .then((current) => setStatus((pushed) => pushed ?? current))
      .catch((error: unknown) => console.warn("[updates] status failed", error));
    return stop;
  }, []);
  return status;
}

/** The version on offer, while there is one. */
function offeredVersion(status: UpdateStatus | null): string | null {
  return status?.kind === "available" || status?.kind === "downloading" || status?.kind === "downloaded"
    ? status.version
    : null;
}

function describe(status: UpdateStatus | null, t: Translate, locale: Locale): string | undefined {
  switch (status?.kind) {
    case undefined:
      return undefined;
    case "unsupported":
    case "idle":
    case "checking":
      return t(`settings.updatesState.${status.kind}`);
    case "upToDate":
      return t("settings.updatesState.upToDate", {
        time: new Date(status.checkedAt).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }),
      });
    case "available":
    case "downloading":
    case "downloaded":
      return t("settings.updatesState.available", { version: status.version });
    case "error":
      return t(`settings.updatesErrors.${status.code}`);
  }
}

/** Which build this is, whether a newer one is out, and where its logs are —
 *  the things someone on the phone asks for first — under the product's own
 *  name and mark. */
export function AboutSection() {
  const { t, locale } = useI18n();
  const status = useUpdateStatus();
  const offered = offeredVersion(status);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-5 py-2">
        <BrandMark className="size-20 rounded-2xl" />
        <div className="flex flex-col gap-2">
          <Wordmark className="text-5xl" />
          <Caption className="select-text">
            {t("settings.aboutTagline")} · {t("settings.version")} {__APP_VERSION__}
          </Caption>
        </div>
      </div>

      <FieldGroup title={t("settings.groups.about")}>
        <FieldRow description={t("settings.versionDesc")} label={t("settings.version")}>
          <Caption className="select-text">{__APP_VERSION__}</Caption>
        </FieldRow>
        <FieldRow
          description={describe(status, t, locale)}
          label={
            <span className="flex items-center gap-2">
              {t("settings.updates")}
              {offered ? <Badge variant="blue">{t("settings.updatesNew")}</Badge> : null}
            </span>
          }
        >
          {offered ? (
            <Button
              onClick={() => void api.updates.openReleaseNotes().catch(() => toast.danger(t("settings.updatesErrors.unknown")))}
              size="sm"
              variant="outline"
            >
              {t("settings.updatesNotes")}
            </Button>
          ) : null}
          <Button
            disabled={status === null || !canCheck(status)}
            onClick={() => void api.updates.check().catch(() => toast.danger(t("settings.updatesErrors.unknown")))}
            size="sm"
            variant="outline"
          >
            {t("settings.updatesCheck")}
          </Button>
        </FieldRow>
        <FieldRow description={t("settings.logsDesc")} label={t("settings.logs")}>
          <Button
            onClick={() => void api.system.openLogsFolder().catch(() => toast.danger(t("settings.logsError")))}
            size="sm"
            variant="outline"
          >
            {t("settings.logsOpen")}
          </Button>
        </FieldRow>
      </FieldGroup>
    </div>
  );
}
