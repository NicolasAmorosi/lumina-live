import { useState } from "react";
import { useT } from "@renderer/lib/i18n/i18n-provider";
import { Tabs, type TabItem } from "@renderer/components/ui";
import { useLibraryStore } from "@renderer/stores/library.store";
import { BibleBrowser } from "./bible-browser";
import { MediaBrowser } from "./media-browser";
import { ASSET_KINDS, type AssetKind } from "@shared/constants";

type ResourceTab = "bible" | AssetKind;

const LABEL_KEY: Record<ResourceTab, string> = {
  bible: "bible.title",
  video: "library.videos",
  image: "library.images",
  audio: "library.audios",
  ppt: "library.ppts",
};

const TAB_ORDER: readonly ResourceTab[] = ["bible", ...ASSET_KINDS];

/**
 * EasyWorship's resource area: one tabbed browser for everything that can be
 * put on screen. Nothing in here projects anything by itself — every tab funnels
 * through the same preview/go-live pair.
 */
export function ResourcePanel() {
  const t = useT();
  const [tab, setTab] = useState<ResourceTab>("bible");
  const setLibraryTab = useLibraryStore((s) => s.setActiveTab);

  const tabs: TabItem<ResourceTab>[] = TAB_ORDER.map((value) => ({
    icon: value,
    label: t(LABEL_KEY[value]),
    value,
  }));

  return (
    <>
      <Tabs
        onChange={(value) => {
          setTab(value);
          // Keeps Delete/Backspace targeting the list the operator is looking at.
          if (value !== "bible") setLibraryTab(value);
        }}
        tabs={tabs}
        value={tab}
        variant="folder"
      />
      {tab === "bible" ? <BibleBrowser /> : <MediaBrowser kind={tab} />}
    </>
  );
}
