export type BibleVersionDTO = {
  id: number;
  code: string;
  name: string;
  language: string;
  isBuiltin: boolean;
  verseCount: number;
};

export type BibleBookDTO = {
  id: number;
  versionId: number;
  position: number;
  abbrev: string;
  name: string;
  testament: "OT" | "NT";
  chapterCount: number;
};

export type BibleVerseDTO = {
  id: number;
  bookId: number;
  bookName: string;
  chapter: number;
  verse: number;
  text: string;
};

export type BibleSearchHit = BibleVerseDTO & {
  /** The verse, trimmed around the match, with every matched run wrapped in
   *  `SNIPPET_MARK_START`/`SNIPPET_MARK_END`. Read it with `parseSnippet` and
   *  render the pieces as text — see those constants for why it is NOT
   *  markup. */
  snippet: string;
};

/**
 * Delimiters FTS5 wraps a match in, inside `BibleSearchHit.snippet`.
 *
 * Control characters, deliberately, rather than the `<mark>`/`</mark>` this
 * used to carry. A snippet embeds the verse's own text verbatim, and a verse
 * can come from any JSON the operator imports (`bible:import`) — so when the
 * renderer handed that string to `dangerouslySetInnerHTML`, a bible file with
 * `<img src=x onerror=…>` in a verse ran arbitrary script in the control
 * window, which holds the generic `window.worship.invoke` bridge and therefore
 * every IPC channel in the app. Church bible files travel on USB sticks and
 * chat apps; that is not a theoretical path.
 *
 * These two code points cannot be markup in any context, and `parseSnippet`
 * turns them into data the renderer emits as real `<mark>` elements.
 */
export const SNIPPET_MARK_START = "\u0001";
export const SNIPPET_MARK_END = "\u0002";

export type SnippetSegment = { match: boolean; text: string };

/** Splits a `snippet` into plain and matched runs. Tolerates an unbalanced or
 *  absent delimiter (an FTS quirk, or a snippet built some other way): the
 *  remainder is returned as text, never dropped. */
export function parseSnippet(snippet: string): SnippetSegment[] {
  const segments: SnippetSegment[] = [];
  const push = (text: string, match: boolean) => {
    if (text.length > 0) segments.push({ match, text });
  };

  let rest = snippet;
  while (rest.length > 0) {
    const start = rest.indexOf(SNIPPET_MARK_START);
    if (start < 0) {
      push(rest, false);
      break;
    }
    push(rest.slice(0, start), false);
    const end = rest.indexOf(SNIPPET_MARK_END, start + 1);
    if (end < 0) {
      push(rest.slice(start + 1), true);
      break;
    }
    push(rest.slice(start + 1, end), true);
    rest = rest.slice(end + 1);
  }
  return segments;
}

export type BibleFavorite = {
  id: number;
  versionId: number;
  bookId: number;
  chapter: number;
  verseFrom: number;
  verseTo: number;
  reference: string;
  label: string | null;
  createdAt: number;
};

/** Raw shape of the bundled/importable Bible JSON files. */
export type BibleSourceBook = {
  abbrev: string;
  name?: string;
  nombre?: string;
  chapters: unknown;
};
