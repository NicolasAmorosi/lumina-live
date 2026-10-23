import { useMemo } from "react";
import type { MouseEvent } from "react";
import { Icon, IconButton } from "@renderer/components/ui";
import { useT } from "@renderer/lib/i18n/i18n-provider";
import { cn } from "@renderer/lib/utils";
import { useTimerNow } from "@renderer/lib/hooks/use-timer-now";
import { resetTimer } from "@renderer/lib/actions/utility";
import { useProjectionStore } from "@renderer/stores/projection.store";
import { clockForScene, useUtilityStore } from "@renderer/stores/utility.store";
import { formatTimerClock, hasReachedZero, isTimerRunning } from "@shared/timer";
import type { UtilityScene } from "@shared/types/utility";

/**
 * What the list row of a scene whose clock is actually going shows on its
 * right: the running value, and a single STOP that puts it back at its
 * starting value.
 *
 * Deliberately not a transport. The full controls live on the row of whichever
 * column the scene is in — `UtilityTrackRow`, in PREVIEW and in LIVE — and
 * duplicating them here would give the same timer three play buttons. What
 * this covers is the one case neither of those columns can: a stopwatch
 * started ten minutes ago while the operator went on browsing the library,
 * with nothing on screen to say it is still counting. Losing sight of it is
 * the failure mode; being able to see it, and stop it, without projecting
 * anything is the fix.
 *
 * Mounted only for a scene that is live or armed and started (`UtilitiesPanel`
 * decides), which is what keeps a list of resting scenes from arming a tick
 * each: a wall clock at rest is still a *running* clock, so a row rendering
 * this unconditionally would re-render every second to paint a value nobody
 * asked to see.
 */
export function SceneReadout({ scene }: { scene: UtilityScene }) {
  const t = useT();
  const base = useProjectionStore((s) => s.base);
  const run = useUtilityStore((s) => s.run);

  // Same memo, same key and same reason as `UtilityTrackRow`'s: a fresh clock
  // object on every render would re-arm the tick that caused the render.
  const startOfDay = new Date().setHours(0, 0, 0, 0);
  const clock = useMemo(() => clockForScene(base, run, scene, startOfDay), [base, run, scene, startOfDay]);

  const now = useTimerNow(clock, scene.config.format);
  const running = isTimerRunning(clock);
  const ended = hasReachedZero(clock, now);
  // The two tools that can be stopped at all. The other two are always
  // running, so "back to the start" would leave them exactly where they were.
  const canStop = scene.tool === "countdown" || scene.tool === "stopwatch";

  // A fragment, not a wrapper: `ListRow` already lays `trailing` out as a
  // `flex shrink-0 items-center gap-1`, and nesting a second one only adds a
  // box that can disagree with it.
  return (
    <>
      <span
        className={cn(
          "whitespace-nowrap text-xs tabular-nums",
          ended ? "text-danger-ink" : running ? "text-foreground" : "text-subtle",
        )}
      >
        {formatTimerClock(clock, now, scene.config.format)}
      </span>

      {canStop ? (
        <IconButton
          aria-label={t("utilities.stop")}
          // Pulled back into the row's own padding: a 24 px button inside a
          // 20 px text line would make the one row that has a timer 4 px
          // taller than every other row in the list.
          className="-my-0.5"
          // The row previews on click and goes LIVE on a double click, and
          // both bubble from here. Stopping a timer is neither: it must not
          // move the preview cursor, and it certainly must not project
          // anything because the operator pressed the same button twice.
          onClick={(event: MouseEvent<HTMLButtonElement>) => {
            event.stopPropagation();
            resetTimer(scene);
          }}
          onDoubleClick={(event: MouseEvent<HTMLButtonElement>) => event.stopPropagation()}
          size="xs"
          variant="ghost"
        >
          <Icon name="stop" />
        </IconButton>
      ) : null}
    </>
  );
}
