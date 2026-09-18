import { useState } from "react";
import { useT, type MessageKey } from "@renderer/lib/i18n/i18n-provider";
import { Badge, EmptyState, TabPanel, TabPanels, Tabs, type IconName, type TabItem } from "@renderer/components/ui";
import { PanelBody } from "@renderer/components/shared/panel";
import { UtilitiesPanel } from "@renderer/components/pages/functions/utilities-panel";

type FunctionTab = "utilities" | "inputs" | "overlays";

const TAB_ORDER: readonly FunctionTab[] = ["utilities", "inputs", "overlays"];

const ICON: Record<FunctionTab, IconName> = {
  utilities: "clock",
  inputs: "camera",
  overlays: "overlay",
};

const LABEL_KEY: Record<FunctionTab, MessageKey> = {
  utilities: "functions.utilities",
  inputs: "functions.inputs",
  overlays: "functions.overlays",
};

/** Only the tabs that are still placeholders — Utilities has a real panel now,
 *  so a `Record<FunctionTab, …>` would force an announcement text for a
 *  feature that has shipped. */
type PendingTab = Exclude<FunctionTab, "utilities">;

const TITLE_KEY: Record<PendingTab, MessageKey> = {
  inputs: "functions.inputsTitle",
  overlays: "functions.overlaysTitle",
};

const HINT_KEY: Record<PendingTab, MessageKey> = {
  inputs: "functions.inputsHint",
  overlays: "functions.overlaysHint",
};

const TAB_ID_BASE = "resources-functions";

/**
 * The third resource tab: what can go on the projector that is not a file and
 * not scripture — a countdown, a camera, a lower third.
 *
 * Utilities is built (`plans/2026-09-17-panel-funciones/utilidades.md`); the
 * other two are still announcements. They are real, selectable tabs rather
 * than disabled ones on purpose: the operator gets to read what each one will
 * do, which is the whole value a tab has until its feature lands.
 */
export function FunctionsTabs() {
  const t = useT();
  const [tab, setTab] = useState<FunctionTab>("utilities");

  const tabs: TabItem<FunctionTab>[] = TAB_ORDER.map((value) => ({
    icon: ICON[value],
    label: t(LABEL_KEY[value]),
    value,
  }));

  return (
    <>
      <Tabs idBase={TAB_ID_BASE} onChange={setTab} tabs={tabs} value={tab} variant="segment" />
      <TabPanels>
        {/* Every panel mounted from the start, unlike the media ones: a
            placeholder costs nothing to keep alive and there is no scroll
            position, no listing and no conversion queue behind it. */}
        {TAB_ORDER.map((value) => (
          <TabPanel active={value === tab} idBase={TAB_ID_BASE} key={value} value={value}>
            {value === "utilities" ? (
              <UtilitiesPanel />
            ) : (
              <PanelBody className="p-1.5">
                <EmptyState
                  action={<Badge variant="blue">{t("functions.inDevelopment")}</Badge>}
                  description={t(HINT_KEY[value])}
                  icon={ICON[value]}
                  title={t(TITLE_KEY[value])}
                />
              </PanelBody>
            )}
          </TabPanel>
        ))}
      </TabPanels>
    </>
  );
}
