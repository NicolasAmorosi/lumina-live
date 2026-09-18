import { normalizeForSearch } from "./utils";
import type { MediaAsset, MediaSortOrder } from "@shared/types/media";

/**
 * How a resource grid turns one view's assets into what is on screen: the
 * name filter the operator typed, then the order they picked.
 *
 * Pure and outside React on purpose — it is the only part of the resource
 * panel with real rules in it (numeric collation, the mtime fallback, the
 * tie-breaks), and a component is not a place that can be tested.
 */

/** `numeric` is the whole point: a hymnal folder is "Himno 2", "Himno 10",
 *  "Himno 100", and a plain code-unit comparison puts 100 before 2. `base`
 *  sensitivity makes "Ángel" and "angel" neighbours instead of putting every
 *  accented name after Z, which is what a church library is full of. */
const collator = new Intl.Collator("es", { numeric: true, sensitivity: "base" });

/** The file's own timestamp, falling back to the row's — `mtimeMs` is null
 *  only for an asset that was never stat'd, and sorting those into 1970 would
 *  bury them under everything else. */
function dateOf(asset: MediaAsset): number {
  return asset.mtimeMs ?? asset.createdAt;
}

function sizeOf(asset: MediaAsset): number {
  return asset.sizeBytes ?? 0;
}

/** Every non-name order ends in a name comparison. `Array#sort` is stable, so
 *  without it two files sharing a timestamp (a folder copied in one go — the
 *  common case) would keep whatever order the disk or the database handed
 *  over, which changes between reads of the same folder. */
const comparators: Record<MediaSortOrder, (a: MediaAsset, b: MediaAsset) => number> = {
  "name-asc": (a, b) => collator.compare(a.name, b.name),
  "name-desc": (a, b) => collator.compare(b.name, a.name),
  "date-desc": (a, b) => dateOf(b) - dateOf(a) || collator.compare(a.name, b.name),
  "date-asc": (a, b) => dateOf(a) - dateOf(b) || collator.compare(a.name, b.name),
  "size-desc": (a, b) => sizeOf(b) - sizeOf(a) || collator.compare(a.name, b.name),
  "size-asc": (a, b) => sizeOf(a) - sizeOf(b) || collator.compare(a.name, b.name),
};

/** Never in place: the array handed in is the one the library store holds, and
 *  sorting it there would reorder the store's own copy of the view without any
 *  subscriber being told. */
export function sortAssets(assets: readonly MediaAsset[], order: MediaSortOrder): MediaAsset[] {
  return [...assets].sort(comparators[order]);
}

/**
 * Filters by name, accent- and case-insensitively (`normalizeForSearch`, the
 * same normalizer the Bible book finder and the programs list use).
 *
 * Returns the input array itself when there is nothing to filter, so an empty
 * box costs no allocation and the `useMemo` above it keeps its identity — the
 * prewarm effect downstream is keyed off this list.
 */
export function filterAssetsByName(assets: readonly MediaAsset[], query: string): readonly MediaAsset[] {
  const needle = normalizeForSearch(query);
  if (needle === "") return assets;
  return assets.filter((asset) => normalizeForSearch(asset.name).includes(needle));
}
