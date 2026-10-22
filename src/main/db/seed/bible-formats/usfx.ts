import { canonByStandardCode, type CanonBook } from "./canon";
import { normalizeLanguage } from "./language";
import { BibleFormatError, BookCollector, type ParsedBible } from "./types";
import { leadingNumber, walkXml } from "./xml-ordered";
import { mt } from "../../../i18n";

/**
 * USFX — the single-file XML that eBible.org publishes its whole catalogue in
 * (well over a thousand translations, a dozen of them Spanish and freely
 * redistributable).
 *
 *   <usfx>
 *     <languageCode>spa</languageCode>
 *     <book id="GEN">
 *       <id id="GEN">Génesis</id>
 *       <h>Génesis</h>
 *       <c id="1"/>
 *       <p><v id="1"/>En el principio creó Dios…<ve/><v id="2"/>…</p>
 *
 * Milestoned, so it is read through the ordered walker. Everything that is
 * not the verse's own words is dropped by subtree: footnotes (`f`),
 * cross-references (`x`), figures, section headings (`s`), and the `<id>`
 * line, which is a machine identifier that would otherwise be read as the
 * first words of Genesis 1:1.
 */

/** Dropped whole, children included. `s` is a section heading — real prose,
 *  but the translator's, not the text's, and it sits between two verses where
 *  it would otherwise be swallowed by whichever one is open. */
const SKIPPED = new Set([
  "id",
  "ide",
  "rem",
  "f",
  "fe",
  "ef",
  "x",
  "ex",
  "fig",
  "rq",
  "s",
  "s1",
  "s2",
  "s3",
  "r",
  "mt",
  "mt1",
  "mt2",
  "mt3",
  "ms",
  "ms1",
  "d",
  "cl",
  "cp",
  "toc",
  "table",
  "note",
]);

export function parseUsfx(xml: string): ParsedBible {
  const collector = new BookCollector();
  let language: string | null = null;
  let sawUsfx = false;

  let book: CanonBook | null = null;
  let bookName: string | null = null;
  let chapter = 0;
  let verse: number | null = null;
  let buffer: string[] = [];
  /** `<h>` is the book's printed name and its text must not land in a verse.
   *  Same for `<languageCode>`, which is a header field. */
  let capture: "heading" | "language" | null = null;

  const flush = () => {
    if (book && verse !== null && chapter > 0) {
      collector.add(book, chapter, verse, buffer.join(""), bookName);
    }
    buffer = [];
    verse = null;
  };

  walkXml(xml, {
    enter: (tag, attrs) => {
      if (SKIPPED.has(tag)) return false;

      switch (tag) {
        case "usfx":
          sawUsfx = true;
          return true;
        case "languageCode":
          capture = "language";
          return true;
        case "book": {
          // A book boundary closes whatever was open: a file truncated
          // mid-verse must not spill its tail into the next book.
          flush();
          book = canonByStandardCode(attrs.id ?? "");
          bookName = null;
          chapter = 0;
          // A deuterocanonical or otherwise unknown id still has to be walked
          // past — returning false here would only skip its subtree, which is
          // what we want, but `book` being null already drops every verse in
          // it at `flush`. Skipping outright is cheaper.
          return book !== null;
        }
        case "h":
          capture = "heading";
          return true;
        case "c":
          flush();
          chapter = leadingNumber(attrs.id) ?? chapter;
          return true;
        case "v":
          flush();
          verse = leadingNumber(attrs.id);
          return true;
        case "ve":
          flush();
          return true;
        default:
          return true;
      }
    },
    exit: (tag) => {
      if (tag === "h" || tag === "languageCode") capture = null;
      // A closing `</book>` has to flush too: the last verse of a book has no
      // `<ve/>` in many modules, and a `<v>` of the next book would be a
      // boundary that never comes for the final one in the file.
      if (tag === "book") {
        flush();
        book = null;
      }
    },
    text: (value) => {
      if (capture === "language") {
        language ??= normalizeLanguage(value);
        return;
      }
      if (capture === "heading") {
        const name = value.trim();
        if (name) bookName = name;
        return;
      }
      if (verse !== null) buffer.push(value);
    },
  });

  if (!sawUsfx) throw new BibleFormatError(mt("bible.notUsfx"));
  return { name: null, language, books: collector.finish(language) };
}
