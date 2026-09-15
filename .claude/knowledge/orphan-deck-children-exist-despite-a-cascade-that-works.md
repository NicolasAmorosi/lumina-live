## The real library carries orphan `deck_slides` rows although the cascade demonstrably works
**Area:** data, slides
**Trigger:** before trusting `ON DELETE cascade` to be the whole story for `slide_decks`' children; when `pragma foreign_key_check` returns rows on a user database; when touching `sweepCache()` or any path that deletes a deck

- Believed: `deck_slides`/`deck_audio` can never outlive their `slide_decks` row, because the FK
  declares `ON DELETE cascade` and `src/main/db/client.ts` has set `foreign_keys = ON` on every
  connection since the first commit.
- Measured on the user's live database (2026-09-15): `pragma foreign_key_check` returned **184
  violations** — 183 `deck_slides` rows and the single `deck_audio` row — pointing at **35
  `slide_decks` ids that no longer exist**. The ids are `692`–`725`, one contiguous recent run,
  plus an old `4`, against `max(slide_decks.id) = 726` and 682 surviving decks. A contiguous run at
  the top of the id space is a recent bulk delete that did not take its children.
- What was ruled out, each by direct check, not by reading: the DDL in the live database really
  does say `ON DELETE cascade` for both child tables; `git log -L` shows the `foreign_keys = ON`
  pragma present in the very first commit of `client.ts`; there is no second writer connection and
  no `PRAGMA foreign_keys`/`defer_foreign_keys` toggle anywhere in `src/` or `scripts/`; every
  delete path funnels through `SlidesRepo.deleteDeck` → `deleteDeckRow` (`evictIfOverCap`,
  `deleteUnfinished`, `removeMediaAsset`); and a plain `DELETE FROM slide_decks WHERE id = ?` on a
  `VACUUM INTO` copy of that same live database **did** cascade, leaving 0 children. **The cause
  was not reproduced.** Assume it may still be live.
- Consequence: the mitigation is a sweep, not a guard. `SlidesRepo.deleteOrphanDeckChildren()` is
  called from `sweepCache()` in `src/main/slides/deck-service.ts` — which already exists for
  precisely this ("a crash skips before-quit entirely, so orphan and half-finished state is
  reconciled here") and until now only reconciled cache *directories*, never rows. It **logs**
  `[slides] swept N orphan deck child row(s)`: a non-zero count on a later launch is the only
  signal that whatever produces them is still alive, so do not make it silent.
- Verified: on a copy, 184 → 0 with `slide_decks` untouched at 682 and `integrity_check` ok; then
  on the real database at startup, `[slides] swept 184 orphan deck child row(s)`.
- The rows were harmless to read — every query joins through `slide_decks` — which is exactly why
  they accumulated unnoticed. `pragma foreign_key_check` is not part of `db:smoke` and `pragma
  integrity_check` (which `migrate.ts` does run, on the backup) reports `ok` regardless: it checks
  page structure and indexes, **not** foreign keys. The two are different questions.

**Last updated:** 2026-09-15
