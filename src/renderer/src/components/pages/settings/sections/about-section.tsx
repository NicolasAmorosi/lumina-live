import { useT } from "@renderer/lib/i18n/i18n-provider";
import { BrandMark, Button, Caption, FieldGroup, FieldRow, Wordmark } from "@renderer/components/ui";
import { api } from "@renderer/lib/api";
import { toast } from "@renderer/lib/toast";

/** Which build this is, and where its logs are — the two things someone on
 *  the phone asks for first — under the product's own name and mark. */
export function AboutSection() {
  const t = useT();
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
