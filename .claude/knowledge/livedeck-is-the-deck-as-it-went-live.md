## `liveDeck` is the deck as it went live: a clip made playable afterwards only reaches the deck store
**Area:** renderer
**Trigger:** anything live that depends on a deck's media becoming playable in the background (a
WMA or WMV `deck-clips.ts` converts), or reading `useProjectionStore().liveDeck` for data that
main can still change.

**Last updated:** 2026-10-27

- `goLiveWithDeck` copies the `DeckDTO` into `projection.store`'s `liveDeck` once (`toLiveDeck`)
  and nothing updates it after. When `deck-clips.ts` finishes a playable copy, main emits
  `deck-updated`, and `projection-sync.ts` only calls `useDeckStore.refreshDeck` — **the deck
  store gets the new DTO and `liveDeck` keeps the old one.**
- Found when a liturgy's communion music (a WMA, `deck_audio.playable = 0` until converted) never
  started on its slide. The conversion took a few seconds after the deck was read; the slide was
  reached 30 s later, and still nothing played. `effects/deck-sounds.ts` therefore takes the sounds
  from `useDeckStore().byAssetId[liveDeck.assetId].deck` when its `deckId` matches, and also
  reconciles on every deck-store change, so a sound that becomes playable mid-slide starts there.
- The same gap still holds, by design, for the deck's `soundtrack` and its slide videos: a copy
  that finishes while the deck is live is picked up by the **next** GO LIVE, never swapped under
  the congregation. Don't "fix" those by rewriting `liveDeck` mid-scene without asking.
