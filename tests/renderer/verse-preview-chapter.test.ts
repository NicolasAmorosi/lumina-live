/**
 * A verse in PREVIEW is an index into the chapter the Bible tab has loaded, so
 * loading another chapter must drop it — otherwise PREVIEW, and the Enter that
 * follows, silently become whatever verse sits at that index in the new one.
 */
import { beforeEach, expect, test, vi } from "vitest";
import { useBibleStore } from "@renderer/stores/bible.store";
import { usePreviewStore } from "@renderer/stores/preview.store";
import type { BibleVerseDTO } from "@shared/types/bible";

const verse = (bookId: number, chapter: number, n: number): BibleVerseDTO => ({
  id: bookId * 1000 + chapter * 100 + n,
  bookId,
  bookName: bookId === 43 ? "Juan" : "Romanos",
  chapter,
  verse: n,
  text: `${chapter}:${n}`,
});

beforeEach(() => {
  (window as unknown as { worship: unknown }).worship = {
    invoke: vi.fn((channel: string, req: { bookId: number; chapter: number }) =>
      Promise.resolve(
        channel === "bible:chapter"
          ? { ok: true, data: Array.from({ length: 20 }, (_, i) => verse(req.bookId, req.chapter, i + 1)) }
          : { ok: true, data: [] },
      ),
    ),
    on: () => () => {},
  };
  usePreviewStore.getState().clear();
});

test("browsing to another chapter drops the verse in PREVIEW", async () => {
  await useBibleStore.getState().setBookAndChapter(43, 3);
  usePreviewStore.getState().setTarget({ kind: "verse", verseIndex: 15 });

  await useBibleStore.getState().setBookAndChapter(45, 8);
  expect(usePreviewStore.getState().target).toBeNull();
});

test("reloading the same chapter keeps it", async () => {
  await useBibleStore.getState().setBookAndChapter(43, 3);
  usePreviewStore.getState().setTarget({ kind: "verse", verseIndex: 15 });

  await useBibleStore.getState().setBookAndChapter(43, 3);
  expect(usePreviewStore.getState().target).toEqual({ kind: "verse", verseIndex: 15 });
});

test("any other PREVIEW target is left alone", async () => {
  usePreviewStore.getState().setTarget({ kind: "asset", assetId: 4, assetKind: "image" });
  await useBibleStore.getState().setBookAndChapter(45, 8);
  expect(usePreviewStore.getState().target).toMatchObject({ kind: "asset", assetId: 4 });
});
