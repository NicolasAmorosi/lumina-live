import { useState, type ReactNode } from "react";
import { Button, DialogContent, DialogFooter, DialogHeader } from "@renderer/components/ui";
import { ModalTitle } from "./ModalTitle";
import { useT } from "@renderer/lib/i18n/i18n-provider";
import { Modal } from "./Modal";
import { toast } from "@renderer/lib/toast";

type ConfirmModalProps = {
  confirmLabel?: string;
  danger?: boolean;
  description?: ReactNode;
  onConfirm: () => Promise<void> | void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  title: string;
};

export function ConfirmModal({
  confirmLabel,
  danger = false,
  description,
  onConfirm,
  onOpenChange,
  open,
  title,
}: ConfirmModalProps) {
  const t = useT();
  const [loading, setLoading] = useState(false);

  async function handleConfirm() {
    setLoading(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch (error) {
      // The modal stays open. A caller with its own error UI handles the
      // failure and does not rethrow, so reaching this means nobody said
      // anything: five confirmations (a forced delete, unlinking a folder,
      // emptying the slide cache…) used to stop their spinner and sit there.
      console.error("[confirm] action failed", error);
      toast.danger(t("app.unexpectedError"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal onOpenChange={onOpenChange} open={open} size="sm">
      <DialogHeader>
        <ModalTitle>{title}</ModalTitle>
      </DialogHeader>
      {description ? <DialogContent className="text-sm text-muted-foreground">{description}</DialogContent> : null}
      <DialogFooter>
        <Button onClick={() => onOpenChange(false)} variant="ghost">
          {t("common.cancel")}
        </Button>
        <Button loading={loading} onClick={() => void handleConfirm()} variant={danger ? "danger" : "primary"}>
          {confirmLabel ?? t("common.confirm")}
        </Button>
      </DialogFooter>
    </Modal>
  );
}
