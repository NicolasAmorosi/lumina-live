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
