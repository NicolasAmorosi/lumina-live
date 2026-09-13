import { useState } from "react";
import { useT } from "@renderer/lib/i18n/i18n-provider";
import { TabPanel, TabPanels, Tabs, type TabItem } from "@renderer/components/ui";
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

/** Prefix for the `tab`/`tabpanel` id pairs — one list on screen, so a
 *  constant is enough and keeps the ids readable in the inspector. */
const TAB_ID_BASE = "resources";

/**
 * EasyWorship's resource area: one tabbed browser for everything that can be
 * put on screen. Nothing in here projects anything by itself — every tab funnels
 * through the same preview/go-live pair.
 */
export function ResourcePanel() {
  const t = useT();
  const [tab, setTab] = useState<ResourceTab>("bible");
  // Tabs are mounted on first visit and never unmounted again (they are
  // hidden, not removed — see `TabPanel`). Unmounting threw away the scroll
  // position, the visible range, the fetched deck statuses and the grid's
  // measured geometry, so every return to a tab re-ran the whole
  // `deck:statuses` + prewarm cycle over a folder the operator had already
  // browsed. Only visited tabs are in here, so the cost is paid per tab
  // actually opened rather than for all five up front.
  const [visited, setVisited] = useState<readonly ResourceTab[]>([tab]);
  const setLibraryTab = useLibraryStore((s) => s.setActiveTab);
  const selectAsset = useLibraryStore((s) => s.select);

  const tabs: TabItem<ResourceTab>[] = TAB_ORDER.map((value) => ({
    icon: value,
    label: t(LABEL_KEY[value]),
    value,
  }));

  return (
    <>
      <Tabs
        idBase={TAB_ID_BASE}
        onChange={(value) => {
          setTab(value);
          setVisited((current) => (current.includes(value) ? current : [...current, value]));
          // Keeps Delete/Backspace targeting the list the operator is looking
          // at. The "bible" branch is not symmetry for its own sake: only
          // `setActiveTab` clears `library.selectedId`, so switching to
          // scripture used to leave a library asset selected off-screen — and
          // `removeSelected()` (the Delete/Backspace shortcut) prefers the
          // library over the schedule, so the next Delete silently removed a
          // video the operator wasn't even looking at.
          if (value === "bible") selectAsset(null);
          else setLibraryTab(value);
        }}
        tabs={tabs}
        value={tab}
        variant="folder"
      />
      <TabPanels>
        {TAB_ORDER.filter((value) => visited.includes(value)).map((value) => (
          <TabPanel active={value === tab} idBase={TAB_ID_BASE} key={value} value={value}>
            {value === "bible" ? (
              <BibleBrowser />
            ) : (
              // `active` is not about painting — the panel handles that. It is
              // what stops a hidden tab from going on asking main to pre-warm
              // the decks in its own visible range, competing with the tab the
              // operator is actually looking at.
              <MediaBrowser active={value === tab} kind={value} />
            )}
          </TabPanel>
        ))}
      </TabPanels>
    </>
  );
}
