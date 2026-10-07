import { useProjectionStore, type ProjectionStoreState } from "@renderer/stores/projection.store";
import { clampTickDelay } from "@shared/timer";

/** What can start, stop or end a plate's count: its clocks, and whether the
 *  plates are on the stage at all. Compared field by field, so the 4 Hz
 *  `setMediaStatus` writes never re-arm anything. */
function selectWatched(state: ProjectionStoreState) {
  return { clocks: state.plateHideClocks, overlay: state.overlay, base: state.base };
}

type Watched = ReturnType<typeof selectWatched>;

const sameWatched = (a: Watched, b: Watched): boolean =>
  a.clocks === b.clocks && a.overlay === b.overlay && a.base === b.base;

/**
 * Takes a plate down once its auto-hide count runs out. Control window only,
 * like every other effect: the projector just stops receiving the plate and
 * plays its exit.
 *
 * The count itself is a `TimerClock` in `projection.store.plateHideClocks`;
 * all this does is call `tickPlateClocks` whenever something it watches
 * changes (which holds or resumes the counts), and once more at the instant
 * the earliest running count reaches zero.
 *
 * ponytail: a plain timeout, re-read from `Date.now()` when it fires — a
 * minimized control window has its timers throttled by Chromium and the plate
 * goes down late, never early. Add a `visibilitychange` resync if that bites.
 */
export function startPlateAutoHide(): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const tick = () => {
    const now = Date.now();
    // May notify, and so re-enter `tick` through the subscription before this
    // call is done — which is why the timeout is cleared only right before
    // being armed, below.
    useProjectionStore.getState().tickPlateClocks(now);
    if (timer !== null) clearTimeout(timer);
    timer = null;
    let soonest: number | null = null;
    for (const clock of Object.values(useProjectionStore.getState().plateHideClocks)) {
      if (clock.mode === "countdown" && clock.state === "running") {
        soonest = soonest === null ? clock.endsAtMs : Math.min(soonest, clock.endsAtMs);
      }
    }
    if (soonest !== null) timer = setTimeout(tick, clampTickDelay(soonest - now));
  };

  const unsubscribe = useProjectionStore.subscribe(selectWatched, tick, { equalityFn: sameWatched });
  tick();

  return () => {
    unsubscribe();
    if (timer !== null) clearTimeout(timer);
  };
}
