## Half the Bible formats put the verse's text OUTSIDE the verse element, a third of the catalogue is still Latin-1, and the file extension is never the truth

**Area:** data
**Trigger:** adding or debugging a Bible import format
(`src/main/db/seed/bible-formats/`), or a report that an imported bible's verses run together,
lost their accents, or came out empty.

- **`fast-xml-parser`'s object model cannot read USFX or OSIS, and it fails silently rather than
  throwing.** Both formats are MILESTONED: `<v id="1"/>` marks where a verse *begins* and the
  verse's words are its next SIBLING, not its children —
  `<v id="1"/>En el principio…<ve/><v id="2"/>Y la tierra…`. Parsed into the object model that
  becomes `{v: […], "#text": "En el principio… Y la tierra…"}` — every verse of the chapter
  concatenated into one string, with nothing left to say where one ended. There is no error and
  the book count looks right. Only `preserveOrder: true` keeps the document order that *is* the
  data, which is why those two share an ordered walker (`xml-ordered.ts`) while Zefania — whose
  verse genuinely is an element, `<VERS vnumber="1">…</VERS>` — is read from the ordinary object
  model.
  - With `preserveOrder`, `trimValues` must be **false**: in a milestoned document the whitespace
    *between* two text runs is the space between two words. Normalize once at the end instead.
  - OSIS has TWO legal verse forms and real files use both — container
    (`<verse osisID="Gen.1.1">text</verse>`) and milestone (`<verse sID=…/>text<verse eID=…/>`).
    The discriminator is the attributes, not the children: flush on exit only when neither `sID`
    nor `eID` is present, or an empty `sID` milestone closes its own verse before the text
    arrives.

- **A large share of the free catalogue is `encoding="ISO-8859-1"`, and Spanish is the language
  where that is fatal.** These are old files; `buffer.toString("utf8")` turns «Génesis» into
  «GÃ©nesis» in every book name and every accented word of every verse — a corruption that
  imports "successfully" and is only visible on the projector. The XML declaration is
  ASCII-compatible in every encoding it could be, so reading the first 200 bytes as `latin1`,
  pulling `encoding="…"` out of it and handing that to `TextDecoder` is safe and is what the file
  is telling you to do. UTF-16LE with a BOM also occurs (Windows-authored Zefania).

- **MyBible.zone and MySword modules are SQLite databases — which means `better-sqlite3` reads
  them with no parser at all, and also that they must be opened `readonly`.** Opening one
  read-write creates a `-wal` and a `-shm` beside the operator's file and can silently upgrade or
  repair it; they picked it out of Downloads to be READ. The two schemas differ in more than
  table names: MySword's `Bible.Book` is the canonical 1..66, MyBible.zone's
  `verses.book_number` is 10, 20, … 730 — the ten-step gaps exist to hold the deuterocanonicals
  (165 Esdras, 170 Tobit, 180 Judith between 160 Nehemiah and 190 Esther), so the mapping is a
  table, never `index * 10`. Their verse text carries pseudo-HTML apparatus that must be removed
  **with its contents**, not just its tags: `<S>430</S>` left half-stripped projects a bare
  "430" in the middle of the sentence, and MySword closes a footnote with `<Rf>` — lowercase, no
  slash — so a close tag that is not recognised swallows the rest of the verse.

- **Dispatch on the bytes, never the extension.** A Zefania module is as likely to be
  `spaRV1909.xml` as `.zefania`, MySword writes `.bbl.mybible` while MyBible.zone writes
  `.SQLite3`, and an operator who renames a file to get past a file dialog is not being
  unreasonable. Magic numbers (`SQLite format 3\0`, `PK\x03\x04`) then a root-element sniff is
  what `detectBibleFormat` does, the same way `container-kind.ts` treats a presentation.

- **Every parser must de-duplicate.** `bible_verses` has a UNIQUE index on
  `(version_id, book_id, chapter, verse)`, so one repeated verse in a hand-assembled module
  aborts the entire import transaction. `BookCollector` owns that, along with dropping empty
  verses (formats carry placeholder elements for passages a translation does not render) and
  re-sorting books into canonical order — a module that stores Revelation first would otherwise
  show up that way in the browser's dropdown.

**Last updated:** 2026-09-20
