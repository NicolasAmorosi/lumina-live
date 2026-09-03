import { useEffect, useState } from "react";
import { useT } from "@renderer/lib/i18n/i18n-provider";
import { Button, EmptyState, Input, Select } from "@renderer/components/ui";
import { PanelBody } from "@renderer/components/shared/panel";
import { useBibleStore } from "@renderer/stores/bible.store";
import { useServiceStore } from "@renderer/stores/service.store";
import { api } from "@renderer/lib/api";
import { projectVerse } from "@renderer/lib/actions/bible";

export function BiblePanel() {
  const t = useT();
  const {
    bookId,
    books,
    chapter,
    currentVerseIndex,
    setBookAndChapter,
    setVersion,
    verses,
    versionId,
    versions,
  } = useBibleStore();
  const loadVersions = useBibleStore((s) => s.loadVersions);
  const addItem = useServiceStore((s) => s.addItem);
  const [pendingBook, setPendingBook] = useState<string>("");
  const [pendingChapter, setPendingChapter] = useState<string>("");
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Awaited<ReturnType<typeof api.bible.search>>>([]);

  useEffect(() => {
    void loadVersions();
  }, [loadVersions]);

  const selectedBook = books.find((b) => b.id === Number(pendingBook));

  async function handleShowChapter() {
    if (!pendingBook || !pendingChapter) return;
    await setBookAndChapter(Number(pendingBook), Number(pendingChapter));
  }

  async function handleSearch(value: string) {
    setQuery(value);
    if (!versionId || value.trim().length < 3) {
      setSearchResults([]);
      return;
    }
    setSearchResults(await api.bible.search(versionId, value));
  }

  function addToList(verseIndex: number) {
    const verse = verses[verseIndex];
    if (!verse || !versionId || !bookId || !chapter) return;
    addItem({
      kind: "bible",
      bibleVersionId: versionId,
      bibleBookId: bookId,
      chapter,
      verseFrom: verse.verse,
      verseTo: verse.verse,
      reference: `${verse.bookName} ${verse.chapter}:${verse.verse}`,
      text: verse.text,
    });
  }

  return (
    <>
      <div className="flex shrink-0 flex-col gap-2 border-b border-border p-2">
        <div className="flex items-center gap-2">
          <Select
            onChange={(e) => void setVersion(Number(e.target.value))}
            options={versions.map((v) => ({ label: v.name, value: String(v.id) }))}
            size="sm"
            value={versionId ? String(versionId) : ""}
          />
          <Button onClick={() => void api.bible.import()} size="xs" variant="ghost">
            {t("bible.import")}
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Select
            onChange={(e) => {
              setPendingBook(e.target.value);
              setPendingChapter("");
            }}
            options={books.map((b) => ({ label: b.name, value: String(b.id) }))}
            placeholder={t("bible.book")}
            size="sm"
            value={pendingBook}
          />
          <Select
            disabled={!selectedBook}
            onChange={(e) => setPendingChapter(e.target.value)}
            options={Array.from({ length: selectedBook?.chapterCount ?? 0 }, (_, i) => ({
              label: String(i + 1),
              value: String(i + 1),
            }))}
            placeholder={t("bible.chapter")}
            size="sm"
            value={pendingChapter}
          />
          <Button onClick={() => void handleShowChapter()} size="sm">
            {t("bible.showChapter")}
          </Button>
        </div>
        <Input icon="search" onChange={(e) => void handleSearch(e.target.value)} placeholder={t("bible.search")} value={query} />
      </div>
      <PanelBody className="p-2">
        {query.trim().length >= 3 ? (
          <ul className="flex flex-col gap-1">
            {searchResults.map((hit) => (
              <li className="rounded-lg p-2 text-sm hover:bg-hover" key={hit.id}>
                <p className="text-xs font-medium text-subtle">
                  {hit.bookName} {hit.chapter}:{hit.verse}
                </p>
                <p dangerouslySetInnerHTML={{ __html: hit.snippet }} />
              </li>
            ))}
          </ul>
        ) : verses.length === 0 ? (
          <EmptyState description={t("bible.emptyHint")} icon="bible" title={t("bible.empty")} />
        ) : (
          <ul className="flex flex-col gap-1">
            {verses.map((verse, index) => (
              <li
                className="cursor-pointer rounded-lg p-2 text-sm hover:bg-hover"
                key={verse.id}
                onClick={() => projectVerse(index)}
              >
                <span className="mr-1 font-semibold text-primary">{verse.verse}</span>
                {verse.text}
              </li>
            ))}
          </ul>
        )}
      </PanelBody>
      <div className="flex shrink-0 items-center justify-center gap-2 border-t border-border p-2">
        <Button
          disabled={currentVerseIndex === null || currentVerseIndex <= 0}
          onClick={() => currentVerseIndex !== null && projectVerse(currentVerseIndex - 1)}
        >
          {t("bible.previous")}
        </Button>
        <Button
          disabled={currentVerseIndex === null}
          onClick={() => currentVerseIndex !== null && addToList(currentVerseIndex)}
          variant="secondary"
        >
          {t("bible.addToList")}
        </Button>
        <Button
          disabled={currentVerseIndex === null || currentVerseIndex >= verses.length - 1}
          onClick={() => currentVerseIndex !== null && projectVerse(currentVerseIndex + 1)}
        >
          {t("bible.next")}
        </Button>
      </div>
    </>
  );
}
