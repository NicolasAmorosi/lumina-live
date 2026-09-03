import { useEffect, useState } from "react";
import { useT } from "@renderer/lib/i18n/i18n-provider";
import { Modal } from "@renderer/components/shared/modal";
import { Button, DialogContent, DialogFooter, DialogHeader, EmptyState, Input, Title } from "@renderer/components/ui";
import { useServiceStore } from "@renderer/stores/service.store";
import { api } from "@renderer/lib/api";
import type { ServiceSummary } from "@shared/types/service";

export function ServicesModal({ onOpenChange, open }: { onOpenChange: (open: boolean) => void; open: boolean }) {
  const t = useT();
  const [services, setServices] = useState<ServiceSummary[]>([]);
  const [name, setName] = useState("");
  const { currentServiceId, currentServiceName, items, loadService } = useServiceStore();

  useEffect(() => {
    if (open) {
      setName(currentServiceName);
      void api.services.list().then(setServices);
    }
  }, [open, currentServiceName]);

  async function handleSave() {
    const draft = items.map(({ id: _id, position: _position, ...rest }) => rest as never);
    const summary = await api.services.save(
      currentServiceId !== null ? { id: currentServiceId, name, items: draft } : { name, items: draft },
    );
    onOpenChange(false);
    const full = await api.services.load(summary.id);
    loadService(full);
  }

  async function handleOpen(id: number) {
    const full = await api.services.load(id);
    loadService(full);
    onOpenChange(false);
  }

  async function handleDelete(id: number) {
    await api.services.delete(id);
    setServices(await api.services.list());
  }

  return (
    <Modal onOpenChange={onOpenChange} open={open} size="md">
      <DialogHeader>
        <Title as="h3">{t("services.title")}</Title>
      </DialogHeader>
      <DialogContent className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Input onChange={(e) => setName(e.target.value)} placeholder={t("services.name")} value={name} />
          <Button onClick={() => void handleSave()}>{t("services.save")}</Button>
        </div>
        {services.length === 0 ? (
          <EmptyState title={t("services.empty")} />
        ) : (
          <ul className="flex flex-col gap-1">
            {services.map((s) => (
              <li className="flex items-center justify-between rounded-lg px-2 py-1.5 hover:bg-hover" key={s.id}>
                <button className="flex-1 text-left text-sm" onClick={() => void handleOpen(s.id)} type="button">
                  {s.name} <span className="text-xs text-subtle">({s.itemCount})</span>
                </button>
                <Button onClick={() => void handleDelete(s.id)} size="xs" variant="ghost">
                  {t("services.delete")}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
      <DialogFooter>
        <Button onClick={() => onOpenChange(false)} variant="ghost">
          {t("common.cancel")}
        </Button>
      </DialogFooter>
    </Modal>
  );
}
