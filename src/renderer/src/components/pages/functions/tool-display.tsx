import type { IconName } from "@renderer/components/ui";
import type { MessageKey } from "@renderer/lib/i18n/i18n-provider";
import type { TimerTool } from "@shared/types/timer";

/** Icon per tool. A `Record` keyed by the union, so a fifth tool cannot be
 *  added without deciding what it looks like. */
export const TOOL_ICON: Record<TimerTool, IconName> = {
  countdown: "hourglass",
  "countdown-to-time": "alarm",
  clock: "clock",
  stopwatch: "timer",
};

/** Explicit map rather than an interpolated key: `MessageKey` is a union of
 *  every path in the dictionary, and a key built from a runtime value is
 *  exactly what that type exists to forbid (see `i18n-provider.tsx`). */
export const TOOL_LABEL: Record<TimerTool, MessageKey> = {
  countdown: "utilities.tools.countdown",
  "countdown-to-time": "utilities.tools.countdownToTime",
  clock: "utilities.tools.clock",
  stopwatch: "utilities.tools.stopwatch",
};
