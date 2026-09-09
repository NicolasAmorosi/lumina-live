## `resolveLinkedAudio`'s "only audio file in the folder" fallback was a false-positive machine, and "Remove" wasn't actually removing anything
**Area:** slides
**Trigger:** a PPT with no audio of its own plays a soundtrack that doesn't belong to it; the "Remove" button on a deck's linked audio doesn't stick after a refresh/restart; touching `linked-audio.ts` or `MediaRepo.ensureLinkedAudio`/`setLinkedAudio`.

- `resolveLinkedAudio` (`src/main/slides/linked-audio.ts`) used to have a third rule: if the
  deck's folder held exactly one audio file, that file was assumed to be the deck's soundtrack —
  no name comparison at all. A folder with one PPT that has its own audio and a sibling PPT that
  doesn't (e.g. a mixed-content folder, not a hymnal set) handed the unrelated PPT that same
  audio. Real report: a deck named "re loco" picked up an mp3 with no relation to its name.
- Fixed by replacing that rule with partial containment on a normalized comparison key
  (`comparisonKey`: NFD → strip diacritics → lowercase → alphanumerics only), gated by
  `MIN_MATCH_CHARS = 4` and resolved deterministically (exact key wins over containment; longest
  key wins a tie; a genuine tie between two distinct keys returns `null` rather than guessing).
  There is no more "sole file in the folder" fallback — if nothing's name overlaps, the deck gets
  no audio and the operator assigns one by hand.
- Separately, "Remove" (`setLinkedAudio(id, null)`) was never durable: `MediaRepo.ensureLinkedAudio`
  runs on **every** `toDeckDTO` (i.e. every time a deck is opened or refreshed), and its old guard
  was `if (row.linkedAudioPath && fs.existsSync(...)) return;` — a cleared (`null`) path always
  failed that check, so the heuristic re-ran and wrote the same audio right back. "Remove" behaved
  like "guess again", not "this deck has no audio".
- Fix: a new `media_assets.linked_audio_manual` column (migration `0002_linked_audio_manual.sql`)
  is set to `1` by `setLinkedAudio` on *every* call — assigning a path or clearing it are both
  explicit operator decisions. `ensureLinkedAudio` short-circuits on `linkedAudioManual === 1`, so
  a manual decision is never touched again.
- First attempt at the auto-heal for *non*-manual rows dropped the `fs.existsSync` short-circuit
  entirely and always re-ran `resolveLinkedAudio`. That made switching between decks in the UI
  visibly slower: `peek`/`ensure` (`deck.store.ts`) call `deck:get` on every deck open, which calls
  `ensureLinkedAudio` on every call, and `resolveLinkedAudio` reads the whole source folder and,
  for legacy binaries, the whole presentation file into memory to extract its hint — cheap once,
  not on every click. Fixed properly with a version-gated cache, the same pattern as
  `SLIDES_CONVERTER_VERSION`: `media_assets.linked_audio_resolved_version`
  (migration `0003_linked_audio_resolver_version.sql`) plus `LINKED_AUDIO_RESOLVER_VERSION`
  (`src/shared/constants.ts`). A non-manual row already resolved at the current version, whose
  file (if any) still exists, is trusted as-is — including a cached `null` (confirmed "no match"),
  which used to pay full re-resolution cost forever on decks with no audio. Only a stale version or
  a missing/renamed file triggers a real re-resolve. Bumping `LINKED_AUDIO_RESOLVER_VERSION` is
  what forces every asset to get one fresh check next time its deck opens, whenever the matching
  rules in `linked-audio.ts` change again.
- Related, but a different failure mode: [legacy-pps-linked-audio-resolution.md](legacy-pps-linked-audio-resolution.md)
  (the hint-extraction and NFC/NFD matching this same file also does), and
  [converter-version-must-bump-with-pipeline-fixes.md](converter-version-must-bump-with-pipeline-fixes.md)
  (the same version-gated-cache pattern, one layer over in the slides pipeline).

**Last updated:** 2026-09-09 (revised same day: fixed a perf regression the first version of this fix introduced)
