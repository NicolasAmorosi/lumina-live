import { XMLParser } from "fast-xml-parser";
import { canonByIndex, canonByLooseCode } from "./canon";
import { asPlainText, BibleFormatError, BookCollector, type ParsedBible } from "./types";
import { normalizeLanguage } from "./language";

/**
 * Zefania XML — the most widely mirrored free bible format (the Zefania Sharp
 * collection on SourceForge), and the easiest of the XML three to read
 * because it is genuinely NESTED rather than milestoned:
 *
 *   <XMLBIBLE biblename="…">
 *     <INFORMATION><title>…</title><language>SPA</language></INFORMATION>
 *     <BIBLEBOOK bnumber="1" bname="Génesis" bsname="Gn">
 *       <CHAPTER cnumber="1">
 *         <VERS vnumber="1">En el principio…</VERS>
 *
 * A verse's own content is not always a bare string: modules carry `<STYLE>`,
 * `<gr>`, `<br/>` and `<NOTE>` inside it. Everything but `<NOTE>` is
 * flattened into the text — a study note is the translator talking to a
 * reader, and putting it on a projector behind a congregation is the one
 * outcome nobody wants.
 */
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  trimValues: true,
  parseAttributeValue: false,
  // Forced to arrays so a book with one chapter, or a chapter with one verse,
  // is shaped like every other one. Without this a single-chapter book (Judas,
  // Abdías, 2 and 3 Juan) parses to an object and the loop below silently
  // iterates its KEYS.
  isArray: (name) => ["BIBLEBOOK", "CHAPTER", "VERS"].includes(name),
});

/** Elements whose text belongs to the apparatus and not to the verse. */
const SKIPPED_ELEMENTS = new Set(["NOTE", "note", "xref", "XREF"]);

/**
 * Every run of text under a parsed node, in document order, minus the notes.
 *
 * `fast-xml-parser`'s object model loses the interleaving of text and child
 * elements, so a verse like `dijo <STYLE>Jesús</STYLE> al pueblo` comes back
 * as `{"#text": "dijo al pueblo", STYLE: "Jesús"}` and this concatenation
 * cannot restore the original order. That is a known and accepted limit: the
 * elements that appear mid-verse in real Zefania modules are emphasis and
 * line breaks, which read the same either way, and the alternative is the
 * ordered parser the USFX/OSIS reader needs — far more machinery than this
 * format warrants.
 */
function collectText(node: unknown): string {
  if (typeof node === "string") return node;
  if (typeof node === "number" || typeof node === "boolean") return asPlainText(node);
  if (Array.isArray(node)) return node.map(collectText).join(" ");
  if (node === null || typeof node !== "object") return "";

  const parts: string[] = [];
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    // Attributes are metadata, never content — `@_vnumber` in the middle of a
    // verse would read as the number 1 spliced into the sentence.
    if (key.startsWith("@_")) continue;
    if (SKIPPED_ELEMENTS.has(key)) continue;
    parts.push(collectText(value));
  }
  return parts.filter(Boolean).join(" ");
}

function attr(node: unknown, name: string): string | null {
  if (node === null || typeof node !== "object") return null;
  const value = asPlainText((node as Record<string, unknown>)[`@_${name}`]);
  return value.length > 0 ? value : null;
}

function firstChildText(node: unknown, name: string): string | null {
  if (node === null || typeof node !== "object") return null;
  const child = (node as Record<string, unknown>)[name];
  if (child === undefined) return null;
  const text = collectText(child).trim();
  return text.length > 0 ? text : null;
}

export function parseZefania(xml: string): ParsedBible {
  const root = parser.parse(xml) as Record<string, unknown>;
  const bible = root["XMLBIBLE"] ?? root["xmlbible"] ?? root["X"];
  if (bible === undefined) throw new BibleFormatError("No <XMLBIBLE> root element");

  const information = (bible as Record<string, unknown>)["INFORMATION"];
  const name = firstChildText(information, "title") ?? attr(bible, "biblename");
  const language = normalizeLanguage(firstChildText(information, "language"));

  const books = ((bible as Record<string, unknown>)["BIBLEBOOK"] ?? []) as unknown[];
  const collector = new BookCollector();

  for (const book of books) {
    const number = Number(attr(book, "bnumber"));
    // `bnumber` is the canonical 1..66 position, which is the identity the
    // format is built on. `bsname` is a fallback for the handful of modules
    // that omit the number, and is matched against the canon's own codes.
    const canon =
      (Number.isFinite(number) ? canonByIndex(number) : null) ?? canonByLooseCode(attr(book, "bsname") ?? "");
    // A deuterocanonical book in a Catholic module has no canonical slot here,
    // and is skipped rather than shoehorned into one: the rest of the bible
    // imports perfectly well without it.
    if (!canon) continue;

    const bookName = attr(book, "bname");
    const chapters = ((book as Record<string, unknown>)["CHAPTER"] ?? []) as unknown[];
    for (const chapter of chapters) {
      const chapterNumber = Number(attr(chapter, "cnumber"));
      const verses = ((chapter as Record<string, unknown>)["VERS"] ?? []) as unknown[];
      for (const verse of verses) {
        collector.add(canon, chapterNumber, Number(attr(verse, "vnumber")), collectText(verse), bookName);
      }
    }
  }

  return { name, language, books: collector.finish() };
}
