## A deck cache hit checks that `cache_dir` EXISTS, the protocol checks that it is INSIDE this profile — a copied profile passes one and fails the other
**Area:** slides / data
**Trigger:** slides or slide thumbnails failing to load with `[projection] media error scene worship://deck/<id>/<n>`
on decks that report `ready`; running the app against a copied `userData` (`--user-data-dir=<copy>`); moving a
church's data to a new PC or user account; touching `usable()` in `deck-service.ts` or `withinCache()` in
`worship-protocol.ts`.

- **Believed:** a copy of the user's profile (`cp -cR ~/Library/Application Support/worship-app <tmp>`) is a
  faithful test bed, with the same library and the same already-converted decks.
  **False for every deck converted before the copy.** `slide_decks.cache_dir` is stored as an **absolute** path.
  Measured on 2026-10-14 against a clone of the real library: 683 rows still pointed at the original profile.
- **The two checks disagree.** `usable()` (`src/main/slides/deck-service.ts`, the cache hit and the
  `findDeckByIdentity` relink) only asks `fs.existsSync(row.cacheDir)`. `withinCache()`
  (`src/main/protocol/worship-protocol.ts`) refuses any file that is not under the *current* `slidesCacheDir`.
  So when the old directory still exists, the deck is a cache hit and then every `worship://deck/…` request
  fails. The projector reports it correctly (red band, `media error scene`), but the slides are unusable until
  the deck is force-reconverted. The embedded slide video (`worship://deck-video/<n>`) fails the same way.
- **When it bites and when it heals itself:**
  - Profile copied on the **same machine** (verification clone, a second profile): broken.
  - Profile moved to a **new PC or another user account**, where the old path is gone: `existsSync` is false,
    so each deck reconverts on first use. It recovers, but the copied cache is wasted.
  - Same path on the new machine (same Windows user name): works.
- **For a verification clone**, repoint the rows before launching:
  `UPDATE slide_decks SET cache_dir = replace(cache_dir, '<old userData>/', '<clone>/')`.
- **The structural fix, if it ever matters:** make `usable()` require `withinCache(row.cacheDir)` as well, so a
  foreign row is a cache miss that reconverts instead of a hit that 403s. Storing the path relative to
  `slidesCacheDir` would be the other option.

**Last updated:** 2026-10-14
