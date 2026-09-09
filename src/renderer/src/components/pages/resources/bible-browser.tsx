import { useEffect, useMemo, useState } from "react";
import { useT } from "@renderer/lib/i18n/i18n-provider";
import { EmptyState, Icon, IconButton, Input, ListRow, Select, Tooltip } from "@renderer/components/ui";
import { PanelBody, PanelFooter } from "@renderer/components/shared/panel";
import { useBibleStore } from "@renderer/stores/bible.store";
import { usePreviewStore } from "@renderer/stores/preview.store";
import { api } from "@renderer/lib/api";
import { addVerseToSchedule, previewSearchHit } from "@renderer/lib/actions/bible";
import { previewVerse } from "@renderer/lib/actions/preview";
import { goLive } from "@renderer/lib/actions/playback";
import type { BibleBookDTO, BibleSearchHit } from "@shared/types/bible";

const MIN_TEXT_QUERY_LENGTH = 3;

type SearchMode = "reference" | "text";

type ReferenceMatch = { book: BibleBookDTO; chapter: number | null };

function normalize(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/** Splits "juan 3" into name="juan"/chapter=3, or "juan" into name="juan"/chapter=null. */
function parseReferenceQuery(query: string): { chapter: number | null; name: string } {
  const match = /^(.+?)\s+(\d+)$/.exec(query.trim());
  if (!match?.[1] || !match[2]) return { chapter: null, name: query };
  return { chapter: Number(match[2]), name: match[1] };
}

function matchReference(books: BibleBookDTO[], query: string): ReferenceMatch[] {
  const { chapter, name } = parseReferenceQuery(query);
  const normalizedName = normalize(name);
  if (!normalizedName) return [];

  const matchingBooks = books.filter(
    (b) => normalize(b.name).includes(normalizedName) || normalize(b.abbrev).includes(normalizedName),
  );

  if (chapter === null) return matchingBooks.map((book) => ({ book, chapter: null }));
  return matchingBooks.filter((b) => chapter >= 1 && chapter <= b.chapterCount).map((book) => ({ book, chapter }));
}

/** Scripture as one more resource tab: browse or search, click to preview,
 *  double-click to go live. Search defaults to a quick book/chapter finder;
 *  a toggle switches it to full-text verse search. */
export function BibleBrowser() {
  const t = useT();
  const { books, currentVerseIndex, setBookAndChapter, setVersion, verses, versionId, versions } =
    useBibleStore();
  const loadVersions = useBibleStore((s) => s.loadVersions);
  const target = usePreviewStore((s) => s.target);
  const [pendingBook, setPendingBook] = useState("");
  const [pendingChapter, setPendingChapter] = useState("");
  const [searchMode, setSearchMode] = useState<SearchMode>("reference");
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<BibleSearchHit[]>([]);

  useEffect(() => {
    void loadVersions();
  }, [loadVersions]);

  const selectedBook = books.find((b) => b.id === Number(pendingBook));
  const previewIndex = target?.kind === "verse" ? target.verseIndex : null;
  const searching = searchMode === "text" ? query.trim().length >= MIN_TEXT_QUERY_LENGTH : query.trim().length > 0;

  const referenceMatches = useMemo(
    () => (searchMode === "reference" ? matchReference(books, query) : []),
    [books, query, searchMode],
  );

  async function handleTextSearch(value: string) {
    if (versionId === null || value.trim().length < MIN_TEXT_QUERY_LENGTH) {
      setSearchResults([]);
      return;
    }
    setSearchResults(await api.bible.search(versionId, value));
  }

  function toggleSearchMode() {
    setSearchMode((mode) => (mode === "reference" ? "text" : "reference"));
    setQuery("");
    setSearchResults([]);
  }

  function selectReferenceMatch(match: ReferenceMatch) {
    setPendingBook(String(match.book.id));
    if (match.chapter !== null) {
      setPendingChapter(String(match.chapter));
      void setBookAndChapter(match.book.id, match.chapter);
    } else {
      setPendingChapter("");
    }
    setQuery("");
  }

  return (
    <>
      <div className="flex shrink-0 flex-col gap-1.5 border-b border-border p-1.5">
        <div className="flex items-center gap-1.5">
          <Select
            className="min-w-0 flex-[3]"
            onChange={(value) => void setVersion(Number(value))}
            options={versions.map((v) => ({ label: v.name, value: String(v.id) }))}
            size="sm"
            value={versionId !== null ? String(versionId) : ""}
          />
          <Select
            className="min-w-0 flex-[3]"
            onChange={(value) => {
              setPendingBook(value);
              setPendingChapter("");
            }}
            options={books.map((b) => ({ label: b.name, value: String(b.id) }))}
            placeholder={t("bible.book")}
            size="sm"
            value={pendingBook}
          />
          <Select
            className="min-w-16 flex-1"
            disabled={!selectedBook}
            onChange={(value) => {
              setPendingChapter(value);
              void setBookAndChapter(Number(pendingBook), Number(value));
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
        <div className="flex items-center gap-1.5">
          <Tooltip
            align="start"
            content={
              searchMode === "reference" ? t("bible.searchModeToggleHint") : t("bible.searchModeToggleHintReference")
            }
            placement="top"
          >
            <IconButton
              aria-label={
                searchMode === "reference" ? t("bible.searchModeToggleHint") : t("bible.searchModeToggleHintReference")
              }
              onClick={toggleSearchMode}
              size="sm"
              toggled={searchMode === "text"}
            >
              <Icon name="fileText" />
            </IconButton>
          </Tooltip>
          <div className="min-w-0 flex-1">
            <Input
              icon="search"
              onChange={(e) => {
                const value = e.target.value;
                setQuery(value);
                if (searchMode === "text") void handleTextSearch(value);
              }}
              placeholder={searchMode === "reference" ? t("bible.referenceSearch") : t("bible.search")}
              value={query}
            />
          </div>
        </div>
      </div>

      <PanelBody className="p-1.5">
        {searching ? (
          searchMode === "text" ? (
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
          ) : referenceMatches.length === 0 ? (
            <EmptyState icon="bible" title={t("bible.noResults")} />
          ) : (
            <ul className="flex flex-col gap-0.5">
              {referenceMatches.map((match) => (
                <ListRow
                  key={`${match.book.id}-${match.chapter ?? "book"}`}
                  onClick={() => selectReferenceMatch(match)}
                >
                  {match.chapter !== null ? `${match.book.name} ${match.chapter}` : match.book.name}
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
        <Tooltip className="ml-auto" content={t("resources.addToScheduleHint")} placement="top">
          <IconButton
            aria-label={t("resources.addToSchedule")}
            disabled={previewIndex === null}
            onClick={() => previewIndex !== null && addVerseToSchedule(previewIndex)}
            size="sm"
            variant="primary"
          >
            <Icon name="addToSchedule" />
          </IconButton>
        </Tooltip>
      </PanelFooter>
    </>
  );
}
