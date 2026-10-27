## An OOXML sound plays for `numSld` slides, and `showWhenStopped="0"` hides its icon — neither is guessable from whether it loops
**Area:** slides
**Trigger:** touching `pptx-metadata.ts`'s audio refs, `placeAudio`, `DeckDTO.sounds` /
`soundtrack`, or `reader.ts`'s `hiddenMedia`; a deck whose music plays on the wrong slides, never
stops, or whose speaker icon shows on the projector.

**Last updated:** 2026-10-27

- **How long a sound plays is `p:cMediaNode/@numSld`**: PowerPoint's «stop playing after N slides»,
  its own slide included. **Absent means 1 — this slide only**; «play across slides» writes 999.
  The old reader guessed the scope from the loop flag (`loop → deck`), and a real liturgy
  (`Liturgia18PA2`) shows why that is wrong. Its communion music is a WMA that loops with no
  `numSld`: in PowerPoint it loops **only while the «distribuição» slide is up**. The guess made it
  the deck's soundtrack, playing from slide 1. Its hymn on slide 13 says `numSld="2"`: slides 13–14.
- Read the loop, the volume and `numSld` **from the node that names the shape**
  (`p:tgtEl/p:spTgt/@spid` = the `p:pic`'s `p:cNvPr/@id`), as video already did. A slide can carry
  two sounds, and the slide-wide aggregate hands one the other's settings.
- **`startSlideIndex` was in PowerPoint's numbering (hidden slides counted), never the deck's.** It
  didn't matter while every sound was one soundtrack from slide 1. The moment a sound plays *on* a
  slide, it has to be mapped to visible positions (`placeAudio`), and so does `numSld`: the show
  skips hidden slides, so it counts visible ones. A sound on a hidden slide never plays.
- **«Hide during show» lives in the timing tree, not on the shape**: the media node says
  `showWhenStopped="0"`. Both of the liturgy's speaker icons carry it, and the model drew them
  on the projector until it was read. **PowerPoint's PDF export draws the icon anyway**, so a
  fidelity comparison against it calls the hidden icon a miss: don't "fix" that.
- `liveDeck` doesn't see a clip made playable later: see
  [`livedeck-is-the-deck-as-it-went-live`](livedeck-is-the-deck-as-it-went-live.md).
