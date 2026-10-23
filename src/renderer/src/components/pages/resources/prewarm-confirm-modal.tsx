import { Button, Callout, DialogContent, DialogFooter, DialogHeader } from "@renderer/components/ui";
import { Modal, ModalTitle } from "@renderer/components/shared/modal";
import { useT } from "@renderer/lib/i18n/i18n-provider";

type PrewarmConfirmModalProps = {
  count: number;
  estimatedMinutes: number;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
};

/**
 * The "this can take a while" warning before a "Prepare folder/view"
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
        <ModalTitle>{t("prewarm.title")}</ModalTitle>
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
