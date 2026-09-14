import { useState } from "react";
import { useT } from "@renderer/lib/i18n/i18n-provider";
import { Modal } from "@renderer/components/shared/modal/Modal";
import { DialogHeader, IconButton, Icon, Tabs, type TabItem } from "@renderer/components/ui";
import { ModalTitle } from "@renderer/components/shared/modal";
import { ProjectionSection } from "./sections/projection-section";
import { BibleSection } from "./sections/bible-section";
import { SystemSection } from "./sections/system-section";

type SettingsSection = "projection" | "bible" | "system";

/** The app's settings surface: categories on the left (macOS System Settings
 *  style), a scrollable panel of grouped rows on the right. The dialog itself
 *  has a large, fixed height — switching category never resizes it. Add a new
 *  setting to an existing group/section, or add a section here plus one
 *  `<Tabs>` entry, not another flat row on top of the pile. */
export function SettingsModal({ onOpenChange, open }: { onOpenChange: (open: boolean) => void; open: boolean }) {
  const t = useT();
  const [section, setSection] = useState<SettingsSection>("projection");

  const sections: readonly TabItem<SettingsSection>[] = [
    { icon: "display", label: t("settings.sections.projection"), value: "projection" },
    { icon: "bible", label: t("settings.sections.bible"), value: "bible" },
    { icon: "settings", label: t("settings.sections.system"), value: "system" },
  ];

  return (
    <Modal
      height="tall"
      onOpenChange={(next) => {
        if (!next) setSection("projection");
        onOpenChange(next);
      }}
      open={open}
      size="2xl"
    >
      <DialogHeader className="border-b border-border">
        <ModalTitle>{t("settings.title")}</ModalTitle>
        <IconButton onClick={() => onOpenChange(false)} size="xs" title={t("settings.close")} variant="ghost">
          <Icon name="close" />
        </IconButton>
      </DialogHeader>
      <div className="flex min-h-0 flex-1">
        <Tabs onChange={setSection} tabs={sections} value={section} variant="sidebar" />
        <div className="min-w-0 flex-1 overflow-y-auto p-6">
          {section === "projection" ? (
            <ProjectionSection />
          ) : section === "bible" ? (
            <BibleSection />
          ) : (
            <SystemSection />
          )}
        </div>
      </div>
    </Modal>
  );
}
