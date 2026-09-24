## A book's short code means different books in different formats, so one lookup map silently rewrote the canon — and the testament column had been wrong since the seed was written

**Area:** data
**Trigger:** touching `src/main/db/seed/bible-formats/canon.ts`, adding a Bible file format, or
anything that reads `bible_books.testament` (a book list grouped by testament, a
favourites screen, a reference parser).

- **Believed:** a book has *a* short code, so uppercasing every spelling a format uses — USFX
  `GEN`, OSIS `Gen`, the app's own `gn` — into one `Map` is a convenience. **False, and it
  corrupts the canon.** `jud` is this app's abbreviation for **Jueces**, because that is how the
  bundled `rv1960.json` spells it; `JUD` is USFX's code for **Judas**. Uppercased into one map
  they are the same key, the later entry wins, and Judges becomes a New Testament book. Caught
  only because a test counted: `expected 39 OT books, got 38`. The fix is one map per namespace
  (`canonByStandardCode` / `canonByAbbrev`, plus an explicit `canonByLooseCode` for Zefania's
  free-form `bsname`), never a merged one.

- **The same class of bug was already in the tree, and much bigger.** `bible-source.ts` derived
  `testament` from a hand-written `OT_ABBREVS` set of 39 strings — and that set did not match the
  bible in the box. It spelled Samuel `1s`, Kings `1r`, Psalms `sal`, Proverbs `pr`, Song `cnt`,
  Jeremiah `jer`, Obadiah `abd`…, while `rv1960.json` actually says `1sm`, `1kgs`, `ps`, `prv`,
  `so`, `jr`, `ob`. **Only 16 of the 39 Old Testament books matched**, so the other 23 — Samuel
  through Malachi — have been stored as `testament: "NT"` since the seed was written. Nothing in
  the app reads the column yet, which is the only reason nobody ever saw Isaiah filed next to
  Romans.

- **So the testament is derived from the canonical POSITION, never from a list of names.**
  `testamentOf(index)` is `index <= 39`. Every format here numbers the Protestant canon in the
  same order (Zefania's `bnumber`, MySword's `Book`, MyBible.zone's `book_number`, and the
  standards' code tables), so position is the one signal that cannot drift out of sync with a
  file's own spelling. The JSON reader — the one format that is deliberately tolerant of any
  shape — falls back to the book's position IN THE FILE when its abbreviation is unknown.

- **The app's own abbreviations are not free to change.** `bible_favorites` rows are keyed by
  `(version_code, book_abbrev)` and a reference is shown to the operator, so the canon table's
  `abbrev` column was read out of `rv1960.json` itself rather than invented. A verse imported
  from a Zefania module and the same verse in RV1960 have to be the same `gn 1:1`, or "the same
  reference in two versions" stops being something the app can express.

- **A merged-namespace lookup is invisible without a count.** The unit test that exercises each
  format passes either way — every individual book resolves to *a* book. Only
  `tests/main/data-layer.test.ts`, which seeds the real 66-book bible and asserts `39` OT books
  plus the Malachi/Matthew boundary, catches it. Keep that assertion.

**Last updated:** 2026-09-20
