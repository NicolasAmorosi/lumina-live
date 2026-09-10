import { Panel } from "@renderer/components/shared/panel";
import { SchedulePanel } from "@renderer/components/pages/schedule/SchedulePanel";
import { ResourcePanel } from "@renderer/components/pages/resources/ResourcePanel";
import { SlidesPanel } from "@renderer/components/pages/slides/SlidesPanel";
import { MonitorsColumn } from "@renderer/components/pages/monitors/MonitorsColumn";
import { TopBar } from "./TopBar";

type AppShellProps = {
  onOpenPrograms: (opts?: { mode: "create" }) => void;
  onOpenSettings: () => void;
};

/**
 * The EasyWorship 2009 workspace, in one place:
 *
 *   ┌ top bar ─────────────────────────────────────┐
 *   │ schedule   │ PREVIEW monitor    │ EN VIVO    │
 *   │ ───────────│ ────────────────── │ ────────── │
 *   │ resources  │ slides/verses of   │ LIVE       │
 *   │            │ the previewed item │ ────────── │
 *   │            │                    │ slides/    │
 *   │            │                    │ verses on  │
 *   │            │                    │ air        │
 *   └────────────────────────────────────────────────┘
 *
 * Left to right is browse -> stage -> broadcast, which is why the go-live
 * control sits at the far end of that path and nowhere else. All three
 * columns are equal-width — none of the three jobs (browsing, staging,
 * broadcasting) is visually more important than the others. The centre and
 * right columns mirror each other on purpose: a fixed monitor on top, the
 * same kind of grid underneath — the only difference is whether it's staged
 * or already on the projector.
 */
export function AppShell({ onOpenPrograms, onOpenSettings }: AppShellProps) {
  return (
    <div className="flex h-screen flex-col bg-background">
      <TopBar onOpenPrograms={onOpenPrograms} onOpenSettings={onOpenSettings} />

      <main className="grid min-h-0 flex-1 grid-cols-3 divide-x divide-border">
        <div className="grid min-h-0 grid-rows-[minmax(0,1fr)_minmax(0,1.1fr)] divide-y divide-border">
          <Panel>
            <SchedulePanel />
          </Panel>
          <Panel>
            <ResourcePanel />
          </Panel>
        </div>

        <Panel>
          <SlidesPanel />
        </Panel>

        <Panel>
          <MonitorsColumn />
        </Panel>
      </main>
    </div>
  );
}
