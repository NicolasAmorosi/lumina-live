import { useT } from "@renderer/lib/i18n/i18n-provider";
import { Badge, Icon, ListRow } from "@renderer/components/ui";
import { PanelBody } from "@renderer/components/shared/panel";
import { findScene, useUtilityStore } from "@renderer/stores/utility.store";
import { usePreviewStore } from "@renderer/stores/preview.store";
import { useProjectionStore } from "@renderer/stores/projection.store";
import { previewUtilityScene } from "@renderer/lib/actions/preview";
import { goLive } from "@renderer/lib/actions/playback";
import { TimerTransport } from "./timer-transport";
import { TOOL_ICON, TOOL_LABEL } from "./tool-display";

/**
 * The Utilities tab: the saved time scenes, and the transport of the one
 * timer that is armed.
 *
 * Follows the two-stage flow like every other list in the app — a click
 * previews, a double click goes live, and `goLive()` is the only path to the
 * projector. Starting the countdown is deliberately NOT part of selecting it:
 * a timer that started because somebody clicked a row is a timer nobody asked
 * for. EN VIVO starts it (see `goLiveWithUtilityScene`), and so does the
 * transport's own button.
 */
export function UtilitiesPanel() {
  const t = useT();
  const scenes = useUtilityStore((s) => s.scenes);
  const runSceneId = useUtilityStore((s) => s.run?.sceneId ?? null);
  const target = usePreviewStore((s) => s.target);
  const liveSceneId = useProjectionStore((s) => (s.base?.kind === "utility" ? s.base.sceneId : null));

  const previewedId = target?.kind === "utility" ? target.sceneId : null;
  // The transport follows what the operator is looking at, and falls back to
  // whichever timer is armed — so a countdown started five minutes ago is
  // still there after browsing the rest of the list, instead of disappearing
  // the moment the selection moves.
  const transportSceneId = previewedId ?? runSceneId ?? scenes[0]?.id ?? null;
  const transportScene = transportSceneId === null ? null : findScene(scenes, transportSceneId);

  return (
    <PanelBody className="gap-1.5 p-1.5">
      {transportScene ? <TimerTransport scene={transportScene} /> : null}

      <ul aria-label={t("utilities.listLabel")} className="flex flex-col gap-0.5">
        {scenes.map((scene) => (
          <ListRow
            active={liveSceneId === scene.id}
            key={scene.id}
            leading={
              <Badge className="px-2" variant="neutral">
                <Icon className="size-3.5" name={TOOL_ICON[scene.tool]} />
              </Badge>
            }
            onClick={() => previewUtilityScene(scene.id)}
            onDoubleClick={() => {
              previewUtilityScene(scene.id);
              void goLive();
            }}
            selected={previewedId === scene.id}
            trailing={<span className="text-xs text-subtle">{t(TOOL_LABEL[scene.tool])}</span>}
          >
            {scene.name}
          </ListRow>
        ))}
      </ul>
    </PanelBody>
  );
}
