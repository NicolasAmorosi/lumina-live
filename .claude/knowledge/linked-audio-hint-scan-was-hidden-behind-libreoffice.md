## The linked-audio hint scan cost 0.4–1.7 s per hymn, hidden behind LibreOffice until decks got fast

**Area:** slides
**Trigger:** the first open of a legacy deck takes hundreds of milliseconds although reading it
takes 2 ms; touching `extractHintFromBinary` in `src/main/slides/linked-audio.ts`.

- `MediaRepo.ensureLinkedAudio` (from `toDeckDTO`) found a `.pps`'s linked `.mp3` by running
  `AUDIO_NAME_RE` over the whole file, in 4 MB chunks, as UTF-16LE **and** Latin-1 — synchronously
  on main. Measured in the app on 2026-10-26: **417, 540, 1672 and 423 ms** for four hymns, while
  `readBinaryDeck` took 0.4–2.8 ms and hashing 9 ms. Behind a 0.8 s LibreOffice conversion nobody
  could see it; once a deck is read in milliseconds it was the whole wait — and main blocked means
  the projector's `worship://` requests wait too.
- The path is in a record: the document's `ExObjList` (0x0409) holds, per linked sound, a
  `0x100D` container with an `ExMediaAtom` and a `CString` (0x0FBA) — `C:\Documents and
  Settings\…\522 Suenen las palabras.mp3`. `readBinaryExternalPaths` reads it: **1.85 ms vs 333 ms
  per deck**, and the same basename as the scan for **1231 of 1231** hymnal decks. The scan stays
  only as the fallback for a file with no such record.

**Last updated:** 2026-10-26
