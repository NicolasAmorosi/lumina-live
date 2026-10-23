import { Badge } from "@renderer/components/ui";
import { useT } from "@renderer/lib/i18n/i18n-provider";
import { useTimerNow } from "@renderer/lib/hooks/use-timer-now";
import { useProjectionStore } from "@renderer/stores/projection.store";
import { formatTimerClock } from "@shared/timer";
import { DEFAULT_TIMER_FORMAT, type TimerClock } from "@shared/types/timer";

/**
 * Whether a plate is up, as the trailing slot of a list row — the Overlays
 * list and a `plate` row of the order of service. `null` while it is down.
 *
 * «Covered» says it is up but BLACK, LOGO or an empty stage keeps it off the
 * screen: the operator must never be told a plate is showing when the room
 * cannot see it. A plate that hides itself also shows what it has left,
 * frozen while it is covered.
 */
export function PlateAirStatus({ plateId }: { plateId: number }) {
  const t = useT();
  const up = useProjectionStore((s) => s.livePlates.some((plate) => plate.id === plateId));
  const hideClock = useProjectionStore((s) => (up ? s.plateHideClocks[plateId] : undefined));
  const covered = useProjectionStore((s) => s.overlay !== "none" || s.base === null);
  if (!up) return null;
  return (
    <>
      {hideClock ? <HideCountdown clock={hideClock} /> : null}
      {covered ? (
        <Badge title={t("overlays.coveredHint")} variant="neutral">
          {t("overlays.covered")}
        </Badge>
      ) : (
        <Badge variant="danger">{t("overlays.onAir")}</Badge>
      )}
    </>
  );
}

/** Mounted only for a plate that has a count, so a list without one arms no
 *  tick — and a held count (the plate is covered) arms none either. */
function HideCountdown({ clock }: { clock: TimerClock }) {
  const t = useT();
  const now = useTimerNow(clock, DEFAULT_TIMER_FORMAT);
  return (
    <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground" title={t("overlays.autoHideHint")}>
      {formatTimerClock(clock, now, DEFAULT_TIMER_FORMAT)}
    </span>
  );
}
