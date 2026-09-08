import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// The semantic shadow scale (globals.css --shadow-surface/raised/overlay) isn't
// part of tailwind-merge's default value list for the `shadow` group, so plain
// twMerge doesn't know shadow-surface and shadow-none conflict — both survive
// and cascade order (not className order) picks the winner. Copied from
// libretto-villaaurora's lib/utils.ts, same reason.
const twMerge = extendTailwindMerge({
  extend: { theme: { shadow: ["surface", "raised", "overlay"] } },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

const COMBINING_DIACRITICAL_MARKS = /[̀-ͯ]/g;
export function normalizeForSearch(value: string): string {
  return value.normalize("NFD").replace(COMBINING_DIACRITICAL_MARKS, "").toLowerCase();
}

/** `m:ss`, or `h:mm:ss` past the hour mark — the media transport bars' clock.
 *  Negative or non-finite input (a duration not loaded yet) reads as `0:00`
 *  rather than `NaN:NaN`. */
export function formatClock(totalSeconds: number): string {
  const seconds = Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
