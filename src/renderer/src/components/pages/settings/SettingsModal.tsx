import { useState } from "react";
import { useT } from "@renderer/lib/i18n/i18n-provider";
import { Modal } from "@renderer/components/shared/modal/Modal";
import { DialogHeader, IconButton, Icon, TabPanel, TabPanels, Tabs, type TabItem } from "@renderer/components/ui";
import { ModalTitle } from "@renderer/components/shared/modal";
import { ProjectionSection } from "./sections/projection-section";
import { BibleSection } from "./sections/bible-section";
import { SlidesSection } from "./sections/slides-section";
import { SystemSection } from "./sections/system-section";

type SettingsSection = "projection" | "slides" | "bible" | "system";

const SECTION_ID_BASE = "settings";

/** The app's settings surface: categories on the left (macOS System Settings
 *  style), a scrollable panel of grouped rows on the right. The dialog itself
 *  has a large, fixed height — switching category never resizes it. Add a new
 *  setting to an existing group/section, or add a section here plus one
 *  `<Tabs>` entry, not another flat row on top of the pile. */
export function SettingsModal({ onOpenChange, open }: { onOpenChange: (open: boolean) => void; open: boolean }) {
  const t = useT();
  const [section, setSection] = useState<SettingsSection>("projection");
  // Same shape as `ResourcePanel`: only the categories actually opened are
  // mounted, and a visited one then stays mounted behind `TabPanel`. Nested
  // ternaries remounted the whole section on every switch, throwing away its
  // scroll offset — the Bible list and the slides panel are both long enough
  // to notice.
  const [visited, setVisited] = useState<readonly SettingsSection[]>([section]);

  const sections: readonly TabItem<SettingsSection>[] = [
    { icon: "display", label: t("settings.sections.projection"), value: "projection" },
    { icon: "ppt", label: t("settings.sections.slides"), value: "slides" },
    { icon: "bible", label: t("settings.sections.bible"), value: "bible" },
    { icon: "settings", label: t("settings.sections.system"), value: "system" },
  ];

  return (
    <Modal
      height="tall"
      onOpenChange={(next) => {
        if (!next) {
          setSection("projection");
          // Closing drops what was mounted: settings are read at mount, and
          // reopening the dialog should not show a figure from a previous
          // visit that the operator has since changed elsewhere.
          setVisited(["projection"]);
        }
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
        <Tabs
          idBase={SECTION_ID_BASE}
          onChange={(value) => {
            setSection(value);
            setVisited((current) => (current.includes(value) ? current : [...current, value]));
          }}
          tabs={sections}
          value={section}
          variant="sidebar"
        />
        {/* `TabPanels` positions its panels absolutely, so it needs a flex
            parent that actually gives it a height to fill. */}
        <div className="flex min-w-0 min-h-0 flex-1 flex-col">
          <TabPanels>
            {sections
              .map((s) => s.value)
              .filter((value) => visited.includes(value))
              .map((value) => (
                <TabPanel active={value === section} idBase={SECTION_ID_BASE} key={value} value={value}>
                  <div className="min-w-0 flex-1 overflow-y-auto p-6">
                    {value === "projection" ? (
                      <ProjectionSection />
                    ) : value === "slides" ? (
                      // `active` is not about painting — the panel does that.
                      // The cache figure is read at mount, and a section that
                      // stays mounted would keep showing the number from the
                      // first visit after a conversion or a purge.
                      <SlidesSection active={value === section} />
                    ) : value === "bible" ? (
                      <BibleSection />
                    ) : (
                      <SystemSection />
                    )}
                  </div>
                </TabPanel>
              ))}
          </TabPanels>
        </div>
      </div>
    </Modal>
  );
}
