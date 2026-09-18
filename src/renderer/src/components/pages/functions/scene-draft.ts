import { isUtilitySceneUpsert } from "@shared/scene-validators";
import { DEFAULT_SCENE_STYLE } from "@shared/types/scene-style";
import { DEFAULT_TIMER_FORMAT } from "@shared/types/timer";
import type { UtilityScene, UtilitySceneUpsert } from "@shared/types/utility";

/**
 * The scene being edited in the «Escenas» modal.
 *
 * Structurally a scene minus its id — which is deliberately NOT part of the
 * draft: the modal knows which row it is editing (or that it is creating one),
 * and carrying the id inside the edited value is how a form ends up saving
 * over the wrong row after the list refreshes underneath it.
 */
export type SceneDraft = Omit<UtilityScene, "id">;

/** A brand new scene. A ten-minute countdown, because that is what this
 *  feature exists for — the ten minutes before the service starts. */
export function emptySceneDraft(name: string): SceneDraft {
  return {
    name,
    tool: "countdown",
    config: {
      durationMs: 10 * 60_000,
      targetMinuteOfDay: 10 * 60,
      endMessage: null,
      format: DEFAULT_TIMER_FORMAT,
    },
    style: DEFAULT_SCENE_STYLE,
    title: null,
    message: null,
  };
}

export function toDraft(scene: UtilityScene): SceneDraft {
  const { id: _id, ...draft } = scene;
  return draft;
}

/**
 * Whether this draft is one main would accept.
 *
 * The very same predicate the handler runs, rather than a second, looser set
 * of rules in the UI: a Guardar button that is enabled for something main will
 * reject is a button that lies. The form's own fields already refuse to commit
 * an unparseable duration, so in practice this catches the two things a field
 * cannot: an empty name, and an image background with no image chosen yet.
 */
export function isDraftSavable(draft: SceneDraft): boolean {
  return isUtilitySceneUpsert(draft);
}

/** What goes over the wire. `id` present means update, absent means create —
 *  the shape `UtilitySceneUpsert` describes. */
export function toUpsert(draft: SceneDraft, id: number | null): UtilitySceneUpsert {
  return id === null ? draft : { ...draft, id };
}
