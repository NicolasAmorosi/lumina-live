import { useMemo } from "react";
import { Monitor } from "@renderer/components/ui";
import { OutputView } from "@renderer/components/shared/output-view";
import { timerOutputFor } from "@renderer/lib/utility-output";
import { initialClock } from "@shared/timer";
import { INSTANT_TRANSITION } from "@shared/types/projection";
import type { SceneDraft } from "./scene-draft";

/**
 * The scene as the projector would draw it, while it is being edited.
 *
 * The SAME `OutputView` the projection window and both confidence monitors
 * use, fed by the SAME `timerOutputFor` — which is the whole point, and the
 * rule from `CLAUDE.md`: a preview drawn by a second, simpler renderer is a
 * preview that can disagree with the projector, and the operator would only
 * find out in front of the congregation.
 *
 * The clock is the scene's RESTING value, not the armed timer's: this is the
 * editor, and a countdown here should read as its full duration rather than as
 * whatever is running elsewhere. `INSTANT_TRANSITION` keeps `epoch` fixed, so
 * `OutputView`'s `sameEpoch` short-circuit means typing a title re-renders the
 * text without ever running a scene transition.
 */
export function ScenePreview({ draft }: { draft: SceneDraft }) {
  const output = useMemo(() => {
    // A resting clock only depends on the DATE (a countdown to 10:00 resolves
    // against today), so today's midnight is a memo key that is stable through
    // every tick and still correct for an app left open overnight — the same
    // reasoning `TimerTransport` documents.
    const startOfDay = new Date().setHours(0, 0, 0, 0);
    const scene = { ...draft, id: 0 };
    return {
      ...timerOutputFor(scene, initialClock(draft.tool, draft.config, startOfDay)),
      videoUnderlay: null,
      transition: INSTANT_TRANSITION,
    };
  }, [draft]);

  return <Monitor className="p-0">{<OutputView mode="preview" output={output} />}</Monitor>;
}
