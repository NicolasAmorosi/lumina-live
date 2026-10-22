/**
 * Which "change what the projector shows" request is still the current one.
 *
 * Almost every path that reaches the projector is synchronous. The one that is
 * not is `goLiveWithDeck` (`playback.ts`), which awaits a conversion — and a
 * conversion is not instant: a 400-slide deck, or an interactive job that
 * first had to preempt a running background one, takes seconds. The operator
 * is not frozen while it runs. They press NEGRO because nothing is happening,
 * or navigate the verse that is on air, or send something else live; the
 * conversion then finished and committed anyway, lifting the overlay they had
 * just put up and projecting a deck they had already abandoned, in the middle
 * of a service.
 *
 * So every action that changes what the projector shows claims a new intent
 * before its first `await`, and any commit that has to cross an `await`
 * re-checks that its own intent is still the newest before writing. The last
 * thing the operator did wins, which is also the only rule that can be
 * explained in a dark booth.
 *
 * Same shape as `deck.store.ts`'s `generation` map, and for the same reason —
 * but that one guards the store's entry for an asset, which is not what the
 * congregation sees. This guards the projector itself.
 *
 * A superseded commit is dropped SILENTLY on purpose: the deck still converted
 * and still shows as ready in the library, the LIVE monitor still shows
 * exactly what is going out, so nothing is lying to anyone. A toast
 * mid-service would be noise about a decision the operator already made.
 *
 * It lives in its own module, importing nothing, so that every writer can
 * claim an intent without `playback.ts` ↔ `bible.ts` ↔ `display.store.ts`
 * forming an import cycle. A writer that cannot reach the counter is a writer
 * that silently opts out of the guard — which is exactly how `advanceVerse`
 * and `display.store.open()` were left outside it.
 */
let liveIntent = 0;

/**
 * Claimed by every action that changes the projector, BEFORE its first
 * `await` — the operator's intent starts when they press, not when an IPC
 * round-trip happens to resolve.
 *
 * Call it only once the change is certain: an action that bails out without
 * touching the projector (`advanceSlide` past the last slide) must not cancel
 * a conversion the operator is still waiting on.
 */
export function claimLiveIntent(): number {
  liveIntent += 1;
  return liveIntent;
}

/** The newest claim, WITHOUT making one — for an action that must yield to
 *  the operator's next one but never supersede the last: an audio track sent
 *  live changes nothing on screen, so a deck still converting toward the
 *  projector must still land, while LIMPIAR still silences the track. */
export function currentLiveIntent(): number {
  return liveIntent;
}

/** Whether `intent` is still the newest claim — i.e. nothing has changed the
 *  projector since it was made. */
export function isCurrentLiveIntent(intent: number): boolean {
  return intent === liveIntent;
}
