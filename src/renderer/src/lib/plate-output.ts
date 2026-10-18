import { assetUrl } from "@shared/urls";
import { PLATE_KINDS, platesCollide, type Plate } from "@shared/types/overlay";
import {
  INSTANT_TRANSITION,
  type ProjectionOutput,
  type ProjectionOutputKind,
  type ProjectionPlate,
} from "@shared/types/projection";

/**
 * A plate as the projection window wants it: resolved, image id turned into a
 * url. Shared by `selectOutput`, the PREVIEW monitor and the plate editor's
 * preview — one translation, so no monitor can dress a plate differently from
 * the room (the rule `timerOutputFor` follows for a time scene).
 */
export function plateOutputFor(plate: Plate): ProjectionPlate {
  return {
    id: plate.id,
    kind: plate.kind,
    position: plate.position,
    title: plate.title,
    subtitle: plate.subtitle,
    imageUrl: plate.kind === "bug" && plate.imageAssetId !== null ? assetUrl(plate.imageAssetId) : null,
    style: plate.style,
  };
}

/**
 * What the PREVIEW monitor shows for a previewed plate: the stage as it is
 * LIVE right now, with the plates that would be up once this one goes up —
 * the others stay, the one it collides with is replaced (`showPlate`'s rule).
 *
 * The live video is NOT decoded a third time for it: the projector and the
 * LIVE monitor already each run a copy, and a 4K file does not afford another.
 * `videoStillUrl` (the file's thumbnail, or `null` while it loads) stands in
 * for it — a still is enough to judge whether a name covers a face. A slide's
 * own clip drops out for the same reason; its poster frame is already in the
 * rasterized slide.
 */
export function platePreviewOutput(
  live: ProjectionOutput,
  plate: Plate,
  videoStillUrl: string | null,
): ProjectionOutput {
  const stage: ProjectionOutputKind =
    live.kind === "video" ? (videoStillUrl ? { kind: "image", url: videoStillUrl } : { kind: "black" }) : live;
  const plates = [...live.plates.filter((p) => !platesCollide(p, plate)), plateOutputFor(plate)].sort(
    (a, b) => PLATE_KINDS.indexOf(a.kind) - PLATE_KINDS.indexOf(b.kind),
  );
  return { ...stage, videoUnderlay: null, slideVideo: null, plates, transition: INSTANT_TRANSITION };
}
