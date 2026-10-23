## A slides-pipeline correctness fix does nothing for decks already converted, unless `SLIDES_CONVERTER_VERSION` is bumped
**Area:** slides
**Trigger:** after fixing anything in `deck-service.ts`/`pptx-metadata.ts`/`libreoffice.ts` that changes what a conversion produces — before believing the fix is "done", check whether already-cached decks need to be reconverted too.

- Fixing the [soffice shared-profile race](soffice-shared-profile-race.md) made new conversions
  of a legacy `.pps` deck correctly recover `advTm`/audio — but the user's saved "Culto" service
  still didn't auto-advance after the fix. Root cause, confirmed by reading their real
  `worship.db` directly: the deck that service's PPT item actually points at had been converted
  **before** the fix, so its `slide_decks` row was already sitting at `timings_source: 'none'`
  with every `deck_slides.advance_ms` `NULL` — a real, silent, already-persisted consequence of a
  bug that was fixed in code but not in data.
- `runConversion` (`src/main/slides/deck-service.ts`)'s two cache-hit paths — "cheapest hit" (same
  asset, size+mtime unchanged) and "content-addressed hit" (same content hash) — both gate on
  `converterVersion === SLIDES_CONVERTER_VERSION`. Since that constant
  (`src/shared/constants.ts`) wasn't bumped when the pipeline's correctness changed, both paths
  kept matching the stale row and returning its bad DTO forever. A code fix alone changes nothing
  for a deck that's already in the cache.
- The constant's own doc comment already says to bump it "when the conversion pipeline itself
  changes... fixed OOXML parsing" — this is a concrete case that was missed in the same session as
  the fix that needed it, which is exactly how it'll be missed again for the next pipeline fix.
- Verified end-to-end with the real running app (Chrome DevTools Protocol against the control
  window's own `--remoteDebuggingPort`, no new dependency — Node's built-in `WebSocket`/`fetch`
  calling `window.worship.invoke("deck:ensure", {assetId})`, then actually loading the saved
  service and firing GO LIVE through real DOM clicks): after bumping `SLIDES_CONVERTER_VERSION`,
  the very next `deck:ensure` call — no `force` flag needed — naturally reconverts a
  version-mismatched deck, since the version check alone routes past both cache-hit branches into
  a real reconversion. The live transport then showed slide 1→2 exactly at the 24s boundary,
  matching the audio's own elapsed time.
- Consequence: any future fix to what a conversion produces MUST bump `SLIDES_CONVERTER_VERSION`
  in the same change, or ship a targeted DB fixup — otherwise every deck converted before the fix
  keeps serving the old, wrong output indefinitely, with no error and no visible difference until
  someone notices the *symptom* (e.g. "no auto-advance") days later.

### The other half (2026-10-21): every "is this deck usable?" must check the version, or the bump replaces a deck UNDER the projector

- The bump to 3 (2026-09-24, embedded video) was only honoured by `tryCacheHit`/`runConversion`.
  `getDeck` (`deck:get`, the renderer's `peek`) and `statusesByAsset` (`deck:statuses`, every
  prewarm's "skip what is ready") ignored `converterVersion`. In the real library 677 of 685 decks
  were v2: all of them showed as prepared, no prewarm ever upgraded them, and the upgrade ran at the
  worst possible moment — GO LIVE.
- The sequence: `peek` hands the store a v2 deck as `ready` → `goLiveWithDeck` goes live with it at
  once and fires a background `ensure` (assuming a ready deck is a free cache hit) → `ensure`
  reconverts → `insertDeck` deletes the old row (same `contentHash + renderWidth + imageFormat`) and
  `removeQuietly(finalDir)` wipes the same content-addressed dir → `liveDeck` still holds the old
  `deckId`, so every slide Chromium had not already loaded 404s. The user's report was "the last
  slides of some decks never load", and `main.log` had
  `[projection] media error scene worship://deck/21/13 null` for slides 13–18 of an 18-slide hymn
  whose row 21 had been replaced by 737 in the same second.
- Only a reconversion of the SAME identity is destructive. A render-width or format change makes a
  new row next to the old one, so `getDeck` deliberately does not check `needsRerender`: going live
  instantly with a slightly smaller deck is the documented intent. The version is the one check
  `getDeck` must share with `tryCacheHit`.
- `statusesByAsset` reports an outdated row as `stale` (thumbnail kept — the images are still good),
  so loading a program upgrades it in the `program` lane before the service. Regression test:
  `tests/e2e/decks.spec.ts` "a deck cached by an older converter is reconverted before it goes live",
  which fails without the fix with that exact log line.

**Last updated:** 2026-10-21
