import { useMemo } from "react";
import { useT } from "@renderer/lib/i18n/i18n-provider";
import { cn } from "@renderer/lib/utils";
import { Icon, IconButton, MediaPanel } from "@renderer/components/ui";
import { useTimerNow } from "@renderer/lib/hooks/use-timer-now";
import { clockForScene, useUtilityStore } from "@renderer/stores/utility.store";
import { resetTimer, toggleTimer } from "@renderer/lib/actions/utility";
import { formatTimerClock, hasReachedZero, isTimerRunning } from "@shared/timer";
import type { UtilityScene } from "@shared/types/utility";
import { TOOL_ICON } from "./tool-display";

/**
 * The armed timer, readable and controllable without projecting anything.
 *
 * That is half the value of a stopwatch — measuring a sermon is a thing the
 * operator does for themselves, not for the congregation — and the reason this
 * sits in the panel rather than under the LIVE monitor like `DeckTransport`.
 * Same shell and same geometry as that one, so both read as the same kind of
 * control.
 *
 * The clock and the wall clock are always running and have nothing to start,
 * so they get no buttons at all: a disabled play button would be an invitation
 * to press something that cannot mean anything.
 */
export function TimerTransport({ scene }: { scene: UtilityScene }) {
  const t = useT();
  const run = useUtilityStore((s) => s.run);

  // Memoized, and this is load-bearing rather than an optimization: for a
  // scene whose timer is not armed, `clockForScene` builds a fresh object, and
  // `useTimerNow` below sets state on every tick. Without a stable identity
  // the tick would change that effect's dependency, which would re-arm the
  // tick, which would set state again — a hot loop rather than one re-render
  // per second.
  //
  // Resolving against today's midnight instead of the current instant is what
  // keeps the memo honest: an un-armed "countdown to 10:00" depends on the
  // DATE and nothing finer, so this is stable through every tick and still
  // re-resolves for an app that was left open overnight.
  const startOfDay = new Date().setHours(0, 0, 0, 0);
  const clock = useMemo(() => clockForScene(run, scene, startOfDay), [run, scene, startOfDay]);

  const now = useTimerNow(clock, scene.config.format);
  const value = formatTimerClock(clock, now, scene.config.format);
  const running = isTimerRunning(clock);
  const ended = hasReachedZero(clock, now);
  const started = run?.sceneId === scene.id && run.started;
  const hasControls = scene.tool === "countdown" || scene.tool === "stopwatch";

  return (
    <MediaPanel className="shrink-0">
      <div className="flex items-center gap-2 px-2 py-1.5">
        <Icon className="size-4 shrink-0 text-primary-ink" name={TOOL_ICON[scene.tool]} />

        <span className="min-w-0 flex-1 truncate text-sm text-foreground">{scene.name}</span>

        {/* The one place in the control window that says what the timer is
            doing. A countdown that has run out reads in `danger-ink` — the
            operator has to notice it from across a dark booth, and the
            projector itself will never tell them (it just rests at 00:00). */}
        <span
          className={cn(
            "shrink-0 whitespace-nowrap text-sm font-medium tabular-nums",
            ended ? "text-danger-ink" : running ? "text-foreground" : "text-subtle",
          )}
        >
          {value}
        </span>

        {ended ? (
          <span className="shrink-0 whitespace-nowrap text-xs text-danger-ink">{t("utilities.finished")}</span>
        ) : null}

        {hasControls ? (
          <>
            <IconButton
              aria-label={running ? t("utilities.pause") : started ? t("utilities.resume") : t("utilities.start")}
              onClick={() => toggleTimer(scene)}
              size="xs"
              variant="ghost"
            >
              <Icon name={running ? "pause" : "play"} />
            </IconButton>
            <IconButton
              aria-label={t("utilities.reset")}
              onClick={() => resetTimer(scene)}
              size="xs"
              variant="ghost"
            >
              <Icon name="restart" />
            </IconButton>
          </>
        ) : null}
      </div>
    </MediaPanel>
  );
}
