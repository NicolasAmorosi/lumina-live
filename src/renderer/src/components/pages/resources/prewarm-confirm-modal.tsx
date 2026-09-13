import { Button, Callout, DialogContent, DialogFooter, DialogHeader, Title } from "@renderer/components/ui";
import { Modal } from "@renderer/components/shared/modal/Modal";
import { useT } from "@renderer/lib/i18n/i18n-provider";

type PrewarmConfirmModalProps = {
  count: number;
  estimatedMinutes: number;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
};

/**
 * The "this can take a while" warning before a "Preparar carpeta/vista"
 * batch starts — the user explicitly asked for this before any bulk
 * conversion is allowed to run unattended.
 */
export function PrewarmConfirmModal({
  count,
  estimatedMinutes,
  onConfirm,
  onOpenChange,
  open,
}: PrewarmConfirmModalProps) {
  const t = useT();

  return (
    <Modal onOpenChange={onOpenChange} open={open} size="sm">
      <DialogHeader>
        <Title as="h3">{t("prewarm.title")}</Title>
      </DialogHeader>
      <DialogContent>
        <Callout tone="warning">
          <p className="font-medium">{t("prewarm.warnTitle", { count })}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("prewarm.warnBody", { minutes: estimatedMinutes })}
          </p>
        </Callout>
        <p className="mt-3 text-sm text-muted-foreground">{t("prewarm.body")}</p>
        <p className="mt-1 text-xs text-subtle">{t("prewarm.bodyHint")}</p>
      </DialogContent>
      <DialogFooter>
        <Button onClick={() => onOpenChange(false)} variant="ghost">
          {t("common.cancel")}
        </Button>
        <Button
          onClick={() => {
            onConfirm();
            onOpenChange(false);
          }}
          variant="primary"
        >
          {t("prewarm.start")}
        </Button>
      </DialogFooter>
    </Modal>
  );
}
