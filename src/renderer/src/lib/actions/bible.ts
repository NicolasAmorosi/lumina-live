import { useBibleStore } from "@renderer/stores/bible.store";
import { useProjectionStore } from "@renderer/stores/projection.store";
import { useProgramStore } from "@renderer/stores/program.store";
import { previewVerse } from "@renderer/lib/actions/preview";
import type { DraggedVerse } from "@renderer/lib/dnd";
import type { BibleSearchHit } from "@shared/types/bible";

/** Projects the verse at `index` and marks it current — the single
 *  implementation behind `goLive()` on a verse target and the global ←/→
 *  shortcut (use-global-shortcuts.ts) while scripture is on the projector. */
export function projectVerse(index: number): void {
  const { verses, setCurrentVerseIndex } = useBibleStore.getState();
  const verse = verses[index];
  if (!verse) return;
  const reference = `${verse.bookName} ${verse.chapter}:${verse.verse}`;
  useProjectionStore.getState().setBase({ kind: "bible", text: verse.text, reference });
  setCurrentVerseIndex(index);
}

/** Live navigation: the arrows move what the congregation sees, not the
 *  preview — consistent with a deck, where they drive the live slide too. */
export function advanceVerse(direction: 1 | -1): void {
  const { currentVerseIndex, verses } = useBibleStore.getState();
  if (currentVerseIndex === null) return;
  const next = currentVerseIndex + direction;
  if (next < 0 || next >= verses.length) return;
  projectVerse(next);
}

/** A search hit lives outside the loaded chapter: load it, then preview the
 *  verse the operator actually clicked. */
export async function previewSearchHit(hit: BibleSearchHit): Promise<void> {
  await useBibleStore.getState().setBookAndChapter(hit.bookId, hit.chapter);
  const index = useBibleStore.getState().verses.findIndex((v) => v.verse === hit.verse);
  if (index >= 0) previewVerse(index);
}

/** Builds the drag/schedule payload for the verse at `index` of the loaded
 *  chapter — shared by the click-to-add footer button and the draggable row,
 *  so both add exactly the same item. */
export function buildVerseDrag(index: number): DraggedVerse | null {
  const { bookId, chapter, verses, versionId } = useBibleStore.getState();
  const verse = verses[index];
  if (!verse || versionId === null || bookId === null || chapter === null) return null;
  return {
    bibleVersionId: versionId,
    bibleBookId: bookId,
    chapter,
    verseFrom: verse.verse,
    verseTo: verse.verse,
    reference: `${verse.bookName} ${verse.chapter}:${verse.verse}`,
    text: verse.text,
  };
}

/** Adds the verse at `index` of the loaded chapter to the program. */
export function addVerseToSchedule(index: number): void {
  const payload = buildVerseDrag(index);
  if (!payload) return;
  useProgramStore.getState().addItem({ kind: "bible", ...payload });
}
