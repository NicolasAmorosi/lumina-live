/**
 * The 66 books, and the four different names every Bible file format calls
 * them by.
 *
 * Needed the moment the importer stopped accepting only one JSON shape: a
 * Zefania file identifies a book by `bnumber`, a USFX one by `GEN`, an OSIS
 * one by `Gen`, a MyBible.zone module by the number 10 and a MySword module by
 * the number 1. None of them is the app's own identity for a book, which is
 * its `abbrev` — and that abbrev is not free to invent, because
 * `bible_favorites` rows are keyed by `(version_code, book_abbrev)` and a
 * reference is shown to the operator. So the abbrevs below are exactly the
 * ones the bundled `rv1909.json` already uses, read out of the file itself:
 * a verse imported from a Zefania module and the same verse in RV1909 have to
 * be the same `gn 1:1`, or "the same reference in two versions" stops being a
 * thing the app can express.
 *
 * ## Why `testament` is derived from the POSITION
 *
 * It used to be derived from a set of 39 abbreviations in `bible-source.ts`,
 * and that set did not match the bundled bible: it lists `1s`, `1r`, `sal`,
 * `pr`, `cnt`, `jer`, `abd`… while `rv1909.json` spells those `1sm`, `1kgs`,
 * `ps`, `prv`, `so`, `jr`, `ob`. Only 16 of the 39 Old Testament books
 * matched, so the other 23 — Samuel through Malachi, most of the Old
 * Testament — have been stored with `testament: "NT"` since the seed was
 * written. Nothing reads the column yet, which is the only reason it never
 * showed; the first screen that groups the book list by testament would have
 * put Isaiah next to Romans.
 *
 * Position cannot drift that way: books 1–39 are the Old Testament and 40–66
 * are the New, in every one of the formats here, because all of them number
 * the Protestant canon in the same order.
 */

/** One book, as this app knows it and as five file formats spell it. */
export type CanonBook = {
  /** 1-based canonical position. 1–39 = OT, 40–66 = NT. */
  index: number;
  /** The app's own identity for the book — `rv1909.json`'s spelling. */
  abbrev: string;
  /** Spanish name, used when a file carries no name of its own. */
  name: string;
  /** USFX / Paratext three-letter id (`<book id="GEN">`), uppercase. */
  usfx: string;
  /** OSIS id (`osisID="Gen.1.1"`), as OSIS spells it. */
  osis: string;
  /** MyBible.zone `books.book_number`. MySword uses the canonical index
   *  instead, which is `index` — see `mybible.ts`. */
  myBible: number;
};

/** `[abbrev, name, usfx, osis, myBible]`, in canonical order. Kept as tuples
 *  rather than objects so the whole canon is readable as a table; the exported
 *  `CANON` below is the object form. */
const TABLE: readonly (readonly [string, string, string, string, number])[] = [
  ["gn", "Génesis", "GEN", "Gen", 10],
  ["ex", "Éxodo", "EXO", "Exod", 20],
  ["lv", "Levítico", "LEV", "Lev", 30],
  ["nm", "Números", "NUM", "Num", 40],
  ["dt", "Deuteronomio", "DEU", "Deut", 50],
  ["js", "Josué", "JOS", "Josh", 60],
  ["jud", "Jueces", "JDG", "Judg", 70],
  ["rt", "Rut", "RUT", "Ruth", 80],
  ["1sm", "1 Samuel", "1SA", "1Sam", 90],
  ["2sm", "2 Samuel", "2SA", "2Sam", 100],
  ["1kgs", "1 Reyes", "1KI", "1Kgs", 110],
  ["2kgs", "2 Reyes", "2KI", "2Kgs", 120],
  ["1ch", "1 Crónicas", "1CH", "1Chr", 130],
  ["2ch", "2 Crónicas", "2CH", "2Chr", 140],
  ["ezr", "Esdras", "EZR", "Ezra", 150],
  ["ne", "Nehemías", "NEH", "Neh", 160],
  ["et", "Ester", "EST", "Esth", 190],
  ["job", "Job", "JOB", "Job", 220],
  ["ps", "Salmos", "PSA", "Ps", 230],
  ["prv", "Proverbios", "PRO", "Prov", 240],
  ["ec", "Eclesiastés", "ECC", "Eccl", 250],
  ["so", "Cantares", "SNG", "Song", 260],
  ["is", "Isaías", "ISA", "Isa", 290],
  ["jr", "Jeremías", "JER", "Jer", 300],
  ["lm", "Lamentaciones", "LAM", "Lam", 310],
  ["ez", "Ezequiel", "EZK", "Ezek", 330],
  ["dn", "Daniel", "DAN", "Dan", 340],
  ["ho", "Oseas", "HOS", "Hos", 350],
  ["jl", "Joel", "JOL", "Joel", 360],
  ["am", "Amós", "AMO", "Amos", 370],
  ["ob", "Abdías", "OBA", "Obad", 380],
  ["jn", "Jonás", "JON", "Jonah", 390],
  ["mi", "Miqueas", "MIC", "Mic", 400],
  ["na", "Nahúm", "NAM", "Nah", 410],
  ["hk", "Habacuc", "HAB", "Hab", 420],
  ["zp", "Sofonías", "ZEP", "Zeph", 430],
  ["hg", "Hageo", "HAG", "Hag", 440],
  ["zc", "Zacarías", "ZEC", "Zech", 450],
  ["ml", "Malaquías", "MAL", "Mal", 460],
  ["mt", "Mateo", "MAT", "Matt", 470],
  ["mk", "Marcos", "MRK", "Mark", 480],
  ["lk", "Lucas", "LUK", "Luke", 490],
  ["jo", "Juan", "JHN", "John", 500],
  ["act", "Hechos", "ACT", "Acts", 510],
  ["rm", "Romanos", "ROM", "Rom", 520],
  ["1co", "1 Corintios", "1CO", "1Cor", 530],
  ["2co", "2 Corintios", "2CO", "2Cor", 540],
  ["gl", "Gálatas", "GAL", "Gal", 550],
  ["eph", "Efesios", "EPH", "Eph", 560],
  ["ph", "Filipenses", "PHP", "Phil", 570],
  ["cl", "Colosenses", "COL", "Col", 580],
  ["1ts", "1 Tesalonicenses", "1TH", "1Thess", 590],
  ["2ts", "2 Tesalonicenses", "2TH", "2Thess", 600],
  ["1tm", "1 Timoteo", "1TI", "1Tim", 610],
  ["2tm", "2 Timoteo", "2TI", "2Tim", 620],
  ["tt", "Tito", "TIT", "Titus", 630],
  ["phm", "Filemón", "PHM", "Phlm", 640],
  ["hb", "Hebreos", "HEB", "Heb", 650],
  ["jm", "Santiago", "JAS", "Jas", 660],
  ["1pe", "1 Pedro", "1PE", "1Pet", 670],
  ["2pe", "2 Pedro", "2PE", "2Pet", 680],
  ["1jo", "1 Juan", "1JN", "1John", 690],
  ["2jo", "2 Juan", "2JN", "2John", 700],
  ["3jo", "3 Juan", "3JN", "3John", 710],
  ["jd", "Judas", "JUD", "Jude", 720],
  ["re", "Apocalipsis", "REV", "Rev", 730],
];

export const CANON: readonly CanonBook[] = TABLE.map(([abbrev, name, usfx, osis, myBible], i) => ({
  index: i + 1,
  abbrev,
  name,
  usfx,
  osis,
  myBible,
}));

/** The one rule, and the reason it is a position and not a list of names. */
export function testamentOf(index: number): "OT" | "NT" {
  return index <= 39 ? "OT" : "NT";
}

/**
 * The standards' namespace (USFX + OSIS) and the app's own are SEPARATE maps,
 * and that is not tidiness — merging them is wrong.
 *
 * `jud` is this app's abbreviation for **Jueces**, because that is how
 * `rv1909.json` spells it. `JUD` is USFX's code for **Judas**. Uppercased into
 * one map they are the same key, the later entry wins, and Judges quietly
 * becomes a New Testament book — which is exactly what the data-layer test
 * caught: 38 Old Testament books instead of 39.
 *
 * So a caller says which namespace it is speaking. A USFX/OSIS file is
 * unambiguous within its own standard (no book's USFX code is another book's
 * OSIS id), and the app's abbreviations are unique among themselves.
 */
const BY_STANDARD = new Map<string, CanonBook>();
const BY_ABBREV = new Map<string, CanonBook>();
for (const book of CANON) {
  BY_STANDARD.set(book.usfx.toUpperCase(), book);
  BY_STANDARD.set(book.osis.toUpperCase(), book);
  BY_ABBREV.set(book.abbrev.toUpperCase(), book);
}

const BY_INDEX = new Map(CANON.map((book) => [book.index, book]));
const BY_MYBIBLE = new Map(CANON.map((book) => [book.myBible, book]));

/** A USFX `id` (`GEN`) or an OSIS `osisID` (`Gen.1.1`). The reference is
 *  accepted whole: callers hand over whatever the attribute said rather than
 *  each having to remember to split it. */
export function canonByStandardCode(code: string): CanonBook | null {
  const head = code.trim().split(".")[0] ?? "";
  return BY_STANDARD.get(head.toUpperCase()) ?? null;
}

/** This app's own abbreviation — `rv1909.json`'s spelling, which is also what
 *  `bible_favorites` rows are keyed by. */
export function canonByAbbrev(abbrev: string): CanonBook | null {
  return BY_ABBREV.get(abbrev.trim().toUpperCase()) ?? null;
}

/**
 * A short book name of UNKNOWN namespace — Zefania's `bsname`, which is
 * whatever the module's author typed.
 *
 * The standards win over the app's own abbreviations, because a file that
 * spells a book in three letters is far likelier to be quoting USFX than this
 * app's private table. It is only ever reached when a Zefania module omits
 * `bnumber`, which is the field that actually identifies its books.
 */
export function canonByLooseCode(code: string): CanonBook | null {
  return canonByStandardCode(code) ?? canonByAbbrev(code);
}

/** A canonical 1..66 position — Zefania's `bnumber` and MySword's `Book`. */
export function canonByIndex(index: number): CanonBook | null {
  return BY_INDEX.get(index) ?? null;
}

/** A MyBible.zone `book_number` (10, 20, … 730). */
export function canonByMyBibleNumber(number: number): CanonBook | null {
  return BY_MYBIBLE.get(number) ?? null;
}
