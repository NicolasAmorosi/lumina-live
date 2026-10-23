## Old hymnal `.pps` decks link their soundtrack externally, and the link does not survive a LibreOffice round-trip
**Area:** slides
**Trigger:** a deck has audio in the source folder but the projector stays silent; touching `findLinkedAudio`/`linked-audio.ts`; adding support for another legacy media-linking convention.

- Real church `.pps` decks (legacy binary, PowerPoint 97-2003) don't embed their soundtrack — they
  record an **external** Windows path inside the OLE2 binary, e.g.
  `...\27 himnario\001 Cantad alegres al Señor.mp3`, extractable as a UTF-16LE string. Modern
  `.pptx` can do the same via a slide `_rels` `Relationship` with `TargetMode="External"`.
- `readMetadata`'s legacy-binary upgrade pass converts `.pps → .pptx` with LibreOffice specifically
  to recover `advTm` (see [soffice-shared-profile-race.md](soffice-shared-profile-race.md)) — and
  it **drops the external audio link entirely**: no `a:audioFile`, no surviving external
  relationship, nothing to parse afterward. The link must be read from the *original* file, never
  from the converted one.
  **Correction (2026-09-13):** this entry used to claim that same round-trip "preserves the
  auto-advance timings perfectly". It does not — it drops `advTm` on every slide with no visual
  transition effect, which is 222 of the user's 1226 hymnal decks. The timings are now also read
  from the original file. See
  [libreoffice-pptx-export-drops-advtm-without-a-transition-effect.md](libreoffice-pptx-export-drops-advtm-without-a-transition-effect.md).
- The pre-existing `findLinkedAudio()` only tried `<basename>.mp3` (e.g. `001.mp3`) — the actual
  file was `001 Cantad alegres al Señor.mp3`, so it never matched, and there was no fallback to
  the hint the file itself carries.
- File names round-trip differently across filesystems: macOS favors NFD, while the name recorded
  inside the `.pps` (and Windows generally) favors NFC. Comparing basenames byte-for-byte between
  an extracted hint and `fs.readdirSync()` results silently fails on any accented name
  (`Señor.mp3`) unless both sides are `.normalize("NFC")`'d first — this is *not* an encoding bug,
  both are valid Unicode for the same string.
- Fix: `src/main/slides/linked-audio.ts` resolves in three steps — the file's own internal hint's
  **basename** (never its path, which points at someone else's Windows machine) → the PowerPoint
  convention `<same base>.<audio ext>` → the sole audio file in the folder if only one exists.
  Manual override lives on `media_assets.linked_audio_path` (`library:setLinkedAudio` IPC,
  "Add audio" in `deck-slides.tsx`).
- Storage decision worth remembering: this linked audio is **not** written into `deck_audio` /
  the slides cache. `slide_decks` is keyed by content hash and shared across every library entry
  pointing at identical bytes — baking a folder-dependent sibling file into that shared cache
  would let whichever entry converts first impose its audio on every other entry that happens to
  share the same deck. It's resolved per media asset and served by reference
  (`worship://linked-audio/<assetId>`, `MediaRepo.linkedAudioPathById`) instead.

**Last updated:** 2026-09-13
