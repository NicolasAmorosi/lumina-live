import type { IconName } from "@renderer/components/ui";
import type { MessageKey } from "@renderer/lib/i18n/i18n-provider";
import type { PlateAnimationStyle, PlateKind, PlatePosition } from "@shared/types/overlay";

/** Icon and label per plate kind — `Record`s over the unions, so a new kind
 *  cannot land without deciding how it reads (see `tool-display.ts`). */
export const PLATE_KIND_ICON: Record<PlateKind, IconName> = {
  "lower-third": "text",
  banner: "banner",
  bug: "image",
};

export const PLATE_KIND_LABEL: Record<PlateKind, MessageKey> = {
  "lower-third": "overlays.kinds.lowerThird",
  banner: "overlays.kinds.banner",
  bug: "overlays.kinds.bug",
};

export const PLATE_POSITION_LABEL: Record<PlatePosition, MessageKey> = {
  "top-left": "plates.positions.topLeft",
  "top-center": "plates.positions.topCenter",
  "top-right": "plates.positions.topRight",
  "bottom-left": "plates.positions.bottomLeft",
  "bottom-center": "plates.positions.bottomCenter",
  "bottom-right": "plates.positions.bottomRight",
};

export const PLATE_ANIMATION_LABEL: Record<PlateAnimationStyle, MessageKey> = {
  none: "plates.animations.none",
  fade: "plates.animations.fade",
  slide: "plates.animations.slide",
};
