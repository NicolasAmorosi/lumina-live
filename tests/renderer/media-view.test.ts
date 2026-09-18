/**
 * `lib/media-view.ts` — the rules behind a resource tab's grid.
 *
 * It is the only part of the resource panel with real decisions in it: a
 * hymnal is named "Himno 2 … Himno 100", half a church library is accented,
 * and `mtimeMs`/`sizeBytes` are both nullable columns. Every case here is one
 * of those, and none of them is visible from the component that calls it.
 */
import { describe, expect, test } from "vitest";
import { filterAssetsByName, sortAssets } from "@renderer/lib/media-view";
import type { MediaAsset } from "@shared/types/media";

function asset(partial: Partial<MediaAsset> & { name: string }): MediaAsset {
  return {
    id: 1,
    kind: "ppt",
    ext: "pptx",
    path: `/library/${partial.name}`,
    sizeBytes: 1000,
    mtimeMs: 1000,
    durationMs: null,
    linkedAudioPath: null,
    inLibrary: true,
    missingSince: null,
    createdAt: 1000,
    updatedAt: 1000,
    ...partial,
  };
}

const names = (assets: readonly MediaAsset[]): string[] => assets.map((a) => a.name);

describe("sortAssets", () => {
  test("names sort numerically, not by code unit", () => {
    // The case the whole collator exists for: a real hymnal folder. Plain
    // string comparison puts "Himno 100" between 10 and 2.
    const list = [asset({ name: "Himno 100" }), asset({ name: "Himno 2" }), asset({ name: "Himno 10" })];
    expect(names(sortAssets(list, "name-asc"))).toEqual(["Himno 2", "Himno 10", "Himno 100"]);
    expect(names(sortAssets(list, "name-desc"))).toEqual(["Himno 100", "Himno 10", "Himno 2"]);
  });

  test("an accent does not banish a name past Z", () => {
    const list = [asset({ name: "Biblia" }), asset({ name: "Ángeles" }), asset({ name: "culto" })];
    expect(names(sortAssets(list, "name-asc"))).toEqual(["Ángeles", "Biblia", "culto"]);
  });

  test("date uses the file's mtime, and falls back to the row's createdAt", () => {
    const list = [
      asset({ name: "viejo", mtimeMs: 100 }),
      asset({ name: "nuevo", mtimeMs: 300 }),
      // Never stat'd: without the fallback this would sort as 1970 and end up
      // under everything else rather than where it belongs.
      asset({ name: "sin-mtime", mtimeMs: null, createdAt: 200 }),
    ];
    expect(names(sortAssets(list, "date-desc"))).toEqual(["nuevo", "sin-mtime", "viejo"]);
    expect(names(sortAssets(list, "date-asc"))).toEqual(["viejo", "sin-mtime", "nuevo"]);
  });

  test("a tie falls back to the name, so a folder copied in one go has an order", () => {
    const list = [
      asset({ name: "c", mtimeMs: 500 }),
      asset({ name: "a", mtimeMs: 500 }),
      asset({ name: "b", mtimeMs: 500 }),
    ];
    expect(names(sortAssets(list, "date-desc"))).toEqual(["a", "b", "c"]);
    expect(names(sortAssets(list, "size-desc"))).toEqual(["a", "b", "c"]);
  });

  test("a null size counts as zero rather than dropping the file", () => {
    const list = [asset({ name: "grande", sizeBytes: 900 }), asset({ name: "desconocido", sizeBytes: null })];
    expect(names(sortAssets(list, "size-desc"))).toEqual(["grande", "desconocido"]);
    expect(names(sortAssets(list, "size-asc"))).toEqual(["desconocido", "grande"]);
  });

  test("the input array is never reordered in place", () => {
    // It is the library store's own copy of the view: sorting it there would
    // change what every other subscriber sees, with nothing notified.
    const list = [asset({ name: "b" }), asset({ name: "a" })];
    const sorted = sortAssets(list, "name-asc");
    expect(names(list)).toEqual(["b", "a"]);
    expect(names(sorted)).toEqual(["a", "b"]);
  });
});

describe("filterAssetsByName", () => {
  const list = [asset({ name: "Cántico de María" }), asset({ name: "Sermón 3" }), asset({ name: "video culto" })];

  test("matches ignoring case, accents and surrounding space", () => {
    expect(names(filterAssetsByName(list, "  CANTICO "))).toEqual(["Cántico de María"]);
    expect(names(filterAssetsByName(list, "maria"))).toEqual(["Cántico de María"]);
  });

  test("matches anywhere in the name, not just at the start", () => {
    expect(names(filterAssetsByName(list, "culto"))).toEqual(["video culto"]);
  });

  test("an empty or blank query returns the very same array", () => {
    // Identity, not just equality: the prewarm effect downstream is keyed off
    // this list, and a fresh array on every render would re-arm it.
    expect(filterAssetsByName(list, "")).toBe(list);
    expect(filterAssetsByName(list, "   ")).toBe(list);
  });

  test("no match is an empty list, not the whole view", () => {
    expect(filterAssetsByName(list, "himno")).toEqual([]);
  });
});
