import { useBibleStore } from "@renderer/stores/bible.store";
import { useProjectionStore } from "@renderer/stores/projection.store";

/** Projects the verse at `index` and marks it current — the single
 *  implementation behind BiblePanel's click/prev/next and the global ←/→
 *  shortcut (use-global-shortcuts.ts) when the Bible tab is active. */
export function projectVerse(index: number): void {
  const { verses, setCurrentVerseIndex } = useBibleStore.getState();
  const verse = verses[index];
  if (!verse) return;
  const reference = `${verse.bookName} ${verse.chapter}:${verse.verse}`;
  useProjectionStore.getState().setBase({ kind: "bible", text: verse.text, reference });
  setCurrentVerseIndex(index);
}

export function advanceVerse(direction: 1 | -1): void {
  const { currentVerseIndex, verses } = useBibleStore.getState();
  if (currentVerseIndex === null) return;
  const next = currentVerseIndex + direction;
  if (next < 0 || next >= verses.length) return;
  projectVerse(next);
}
