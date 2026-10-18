import { canonByStandardCode, type CanonBook } from "./canon";
import { normalizeLanguage } from "./language";
import { BibleFormatError, BookCollector, type ParsedBible } from "./types";
import { leadingNumber, walkXml } from "./xml-ordered";

/**
 * OSIS — the CrossWire/SWORD standard, and the format most public-domain
 * bibles are archived in.
 *
 * It has TWO legal ways to mark a verse, and real files use both:
 *
 *   container:  <verse osisID="Gen.1.1">En el principio…</verse>
 *   milestone:  <verse sID="Gen.1.1"/>En el principio…<verse eID="Gen.1.1"/>
 *
 * which is why it shares the ordered walker with USFX rather than being read
 * out of the object model: the milestone form has the same "the text is a
 * sibling, document order is the data" shape that defeats it.
 *
 * `osisID` is what the verse is actually keyed on — `Gen.1.1` names the book,
 * the chapter and the verse in one attribute, so the chapter tracker below is
 * only a fallback for the files that number their verses with a bare `n`.
 */

/** Dropped whole. `title` is the exception that is handled positionally
 *  instead: a `<title>` directly inside the book div is the book's name,
 *  while one three levels down is a section heading in the middle of a
 *  chapter and must not be read as scripture. */
const SKIPPED = new Set([
  "note",
  "figure",
  "index",
  "colophon",
  "header",
  "work",
  "milestone",
  "milestoneStart",
  "milestoneEnd",
]);

type OsisRef = { chapter: number | null; verse: number | null };

/** `Gen.1.1` → chapter 1, verse 1. A reference with fewer parts (a chapter's
 *  own `Gen.1`) yields what it has and `null` for the rest. */
function parseOsisId(id: string | undefined): OsisRef {
  if (!id) return { chapter: null, verse: null };
  // `Gen.1.1!a` and `Gen.1.1-Gen.1.3` both appear; the first reference wins,
  // for the same reason a USFX range is stored under its first number.
  const parts = (id.split(/[\s-]/)[0] ?? "").split(".");
  return { chapter: leadingNumber(parts[1]), verse: leadingNumber(parts[2]) };
}

export function parseOsis(xml: string): ParsedBible {
  const collector = new BookCollector();
  let language: string | null = null;
  let sawOsis = false;

  let book: CanonBook | null = null;
  let bookName: string | null = null;
  /** Depth of the `<div type="book">` currently open, so a `<title>` can be
   *  told from a section heading by where it sits rather than by its own
   *  attributes, which are optional. */
  let bookDepth = -1;
  let chapter = 0;
  let verse: number | null = null;
  let buffer: string[] = [];
  let capture: "bookTitle" | null = null;

  const flush = () => {
    if (book && verse !== null && chapter > 0) {
      collector.add(book, chapter, verse, buffer.join(""), bookName);
    }
    buffer = [];
    verse = null;
  };

  walkXml(xml, {
    enter: (tag, attrs, depth) => {
      if (SKIPPED.has(tag)) return false;

      switch (tag) {
        case "osis":
        case "osisText":
          sawOsis = true;
          language ??= normalizeLanguage(attrs.lang);
          return true;

        case "div": {
          if (attrs.type !== "book") return true;
          flush();
          book = canonByStandardCode(attrs.osisID ?? "");
          bookName = null;
          bookDepth = depth;
          chapter = 0;
          return book !== null;
        }

        case "title":
          // Only the book's own. Anything deeper is a section heading, which
          // is the translator's voice and belongs on no slide.
          if (book !== null && depth === bookDepth + 1) {
            capture = "bookTitle";
            return true;
          }
          return false;

        case "chapter": {
          // An `eID` is the END of a chapter and carries the same osisID as
          // its start — reading it as a chapter number would be harmless, but
          // flushing on it is what closes a trailing verse.
          flush();
          if (attrs.eID !== undefined) return true;
          chapter = parseOsisId(attrs.osisID ?? attrs.sID).chapter ?? leadingNumber(attrs.n) ?? chapter;
          return true;
        }

        case "verse": {
          flush();
          if (attrs.eID !== undefined) return true;
          const ref = parseOsisId(attrs.osisID ?? attrs.sID);
          if (ref.chapter !== null) chapter = ref.chapter;
          verse = ref.verse ?? leadingNumber(attrs.n);
          return true;
        }

        default:
          return true;
      }
    },

    exit: (tag, attrs, depth) => {
      if (tag === "title") capture = null;
      // The container form ends here. Harmless for the milestone form, whose
      // `<verse sID/>` is empty and whose exit therefore fires immediately —
      // which would close the verse before its text arrived. So the container
      // case is the one with children, and an empty `sID` element is
      // recognised by having none.
      if (tag === "verse" && attrs.sID === undefined && attrs.eID === undefined) flush();
      if (tag === "div" && attrs.type === "book" && depth === bookDepth) {
        flush();
        book = null;
        bookDepth = -1;
      }
    },

    text: (value) => {
      if (capture === "bookTitle") {
        const name = value.trim();
        if (name) bookName = name;
        return;
      }
      if (verse !== null) buffer.push(value);
    },
  });

  if (!sawOsis) throw new BibleFormatError("El XML no es una Biblia OSIS: falta el elemento <osis>.");
  return { name: null, language, books: collector.finish() };
}
