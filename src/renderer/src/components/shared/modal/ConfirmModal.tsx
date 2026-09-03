import { useState } from "react";
import { Button, DialogContent, DialogFooter, DialogHeader, Title } from "@renderer/components/ui";
import { Modal } from "./Modal";

type ConfirmModalProps = {
  confirmLabel?: string;
  danger?: boolean;
  description?: string;
  onConfirm: () => Promise<void> | void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  title: string;
};

export function ConfirmModal({
  confirmLabel = "Confirmar",
  danger = false,
  description,
  onConfirm,
  onOpenChange,
  open,
  title,
}: ConfirmModalProps) {
  const [loading, setLoading] = useState(false);

  async function handleConfirm() {
    setLoading(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch {
      // Leave the modal open so the caller's own error UI (toast, etc.) is visible.
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal onOpenChange={onOpenChange} open={open} size="sm">
      <DialogHeader>
        <Title as="h3">{title}</Title>
      </DialogHeader>
      {description ? <DialogContent className="text-sm text-muted-foreground">{description}</DialogContent> : null}
      <DialogFooter>
        <Button onClick={() => onOpenChange(false)} variant="ghost">
          Cancelar
        </Button>
        <Button loading={loading} onClick={handleConfirm} variant={danger ? "danger" : "primary"}>
          {confirmLabel}
        </Button>
      </DialogFooter>
    </Modal>
  );
}
