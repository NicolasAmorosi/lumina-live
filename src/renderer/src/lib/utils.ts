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

export type BoundedSet = {
  has: (value: string) => boolean;
  add: (value: string) => void;
};

/**
 * A `Set` of strings that forgets its oldest entries past `max`.
 *
 * For the module-level registries a virtualized grid needs. A tile that
 * scrolls out of view is unmounted, so anything kept in its own state is gone
 * — but "this url answered 404" and "this url has already decoded once" are
 * facts about the library, not about one mounted component, and re-learning
 * them on every pass is exactly the cost virtualization exists to avoid. Kept
 * bounded because a long session browsing a large library would otherwise grow
 * them without end; a `Set` iterates in insertion order, so its first key is
 * the oldest.
 */
export function createBoundedSet(max: number): BoundedSet {
  const entries = new Set<string>();
  return {
    has: (value) => entries.has(value),
    add: (value) => {
      if (entries.has(value)) return;
      while (entries.size >= max) {
        const oldest = entries.keys().next();
        if (oldest.done) break;
        entries.delete(oldest.value);
      }
      entries.add(value);
    },
  };
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

/** Disk sizes for the operator, not for a log: one decimal, binary units, and
 *  the unit picked from the magnitude — a slide cache is quoted in GB, one
 *  deck in MB. Locale-formatted, so the decimal separator is the comma the
 *  rest of the Spanish UI uses. */
export function formatBytes(bytes: number, locale = "es"): string {
  const units = ["B", "kB", "MB", "GB", "TB"] as const;
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit === 0 ? 0 : 1;
  return `${value.toLocaleString(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits })} ${units[unit]}`;
}
