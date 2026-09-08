import { useEffect, useState } from "react";
import { useT } from "@renderer/lib/i18n/i18n-provider";
import { Button, EmptyState, Input, ListRow, Select } from "@renderer/components/ui";
import { PanelBody, PanelFooter } from "@renderer/components/shared/panel";
import { useBibleStore } from "@renderer/stores/bible.store";
import { usePreviewStore } from "@renderer/stores/preview.store";
import { api } from "@renderer/lib/api";
import { addVerseToSchedule, previewSearchHit } from "@renderer/lib/actions/bible";
import { previewVerse } from "@renderer/lib/actions/preview";
import { goLive } from "@renderer/lib/actions/playback";
import type { BibleSearchHit } from "@shared/types/bible";

const MIN_QUERY_LENGTH = 3;

/** Scripture as one more resource tab: browse or search, click to preview,
 *  double-click to go live. */
export function BibleBrowser() {
  const t = useT();
  const { books, currentVerseIndex, setBookAndChapter, setVersion, verses, versionId, versions } =
    useBibleStore();
  const loadVersions = useBibleStore((s) => s.loadVersions);
  const target = usePreviewStore((s) => s.target);
  const [pendingBook, setPendingBook] = useState("");
  const [pendingChapter, setPendingChapter] = useState("");
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<BibleSearchHit[]>([]);

  useEffect(() => {
    void loadVersions();
  }, [loadVersions]);

  const selectedBook = books.find((b) => b.id === Number(pendingBook));
  const previewIndex = target?.kind === "verse" ? target.verseIndex : null;
  const searching = query.trim().length >= MIN_QUERY_LENGTH;

  async function handleSearch(value: string) {
    setQuery(value);
    if (versionId === null || value.trim().length < MIN_QUERY_LENGTH) {
      setSearchResults([]);
      return;
    }
    setSearchResults(await api.bible.search(versionId, value));
  }

  return (
    <>
      <div className="flex shrink-0 flex-col gap-1.5 border-b border-border p-1.5">
        <div className="flex items-center gap-1.5">
          <Select
            onChange={(e) => void setVersion(Number(e.target.value))}
            options={versions.map((v) => ({ label: v.name, value: String(v.id) }))}
            size="sm"
            value={versionId !== null ? String(versionId) : ""}
          />
          <Button onClick={() => void api.bible.import()} size="xs" variant="ghost">
            {t("bible.import")}
          </Button>
        </div>
        <div className="flex items-center gap-1.5">
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
            onChange={(e) => {
              setPendingChapter(e.target.value);
              void setBookAndChapter(Number(pendingBook), Number(e.target.value));
            }}
            options={Array.from({ length: selectedBook?.chapterCount ?? 0 }, (_, i) => ({
              label: String(i + 1),
              value: String(i + 1),
            }))}
            placeholder={t("bible.chapter")}
            size="sm"
            value={pendingChapter}
          />
        </div>
        <Input
          icon="search"
          onChange={(e) => void handleSearch(e.target.value)}
          placeholder={t("bible.search")}
          value={query}
        />
      </div>

      <PanelBody className="p-1.5">
        {searching ? (
          searchResults.length === 0 ? (
            <EmptyState icon="search" title={t("bible.noResults")} />
          ) : (
            <ul className="flex flex-col gap-0.5">
              {searchResults.map((hit) => (
                <ListRow key={hit.id} onClick={() => void previewSearchHit(hit)}>
                  <span dangerouslySetInnerHTML={{ __html: hit.snippet }} />
                </ListRow>
              ))}
            </ul>
          )
        ) : verses.length === 0 ? (
          <EmptyState description={t("bible.emptyHint")} icon="bible" title={t("bible.empty")} />
        ) : (
          <ul className="flex flex-col gap-0.5">
            {verses.map((verse, index) => (
              <ListRow
                active={currentVerseIndex === index}
                index={verse.verse}
                key={verse.id}
                onClick={() => previewVerse(index)}
                onDoubleClick={() => {
                  previewVerse(index);
                  void goLive();
                }}
                selected={previewIndex === index}
              >
                {verse.text}
              </ListRow>
            ))}
          </ul>
        )}
      </PanelBody>

      <PanelFooter>
        <Button
          disabled={previewIndex === null}
          onClick={() => previewIndex !== null && addVerseToSchedule(previewIndex)}
          size="xs"
          variant="secondary"
        >
          {t("resources.addToSchedule")}
        </Button>
      </PanelFooter>
    </>
  );
}
