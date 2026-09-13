import fsp from "node:fs/promises";
import { SLIDES_MIN_ADVANCE_MS } from "@shared/constants";
import { getSlidesRepo } from "../services/repos";
import { readBinarySlideTimings } from "./ppt-binary-timings";

/**
 * Recovers the auto-advance times that LibreOffice's PPTX export dropped, for
 * decks that were ALREADY converted.
 *
 * New conversions get this for free (`mergeBinaryTimings` in
 * `deck-service.ts`). This is the same fix applied backwards, and the reason
 * it can be: the times live in the source `.pps`, so recovering them needs no
 * LibreOffice, no rasterizing and no cache invalidation — just a re-read of a
 * few dozen KB per file and an `UPDATE` of rows that were `NULL`. Bumping
 * `SLIDES_CONVERTER_VERSION` would have been the mechanism already at hand
 * and would have meant reconverting the whole library, minutes per batch, for
 * images that are already correct.
 *
 * Safety rules, in order of how much they matter:
 *
 * 1. **The file must still be the one that was converted** — `(size, mtime)`
 *    has to match the deck row. Otherwise the times would describe a file
 *    nobody rendered.
 * 2. **The slide counts must match**, or the rows and the source are not
 *    talking about the same slides.
 * 3. **The two readings must agree** wherever both have a number. They come
 *    from independent paths, so a disagreement means one of them is wrong,
 *    and a deck advancing on the wrong slide's timing mid-service is worse
 *    than one that does not advance.
 * 4. **Only `NULL`s are written** — enforced in the SQL itself.
 *
 * Any deck failing a rule is skipped, never half-written.
 */

/** Decks re-read before yielding. `readBinarySlideTimings` is synchronous and
 *  bounded (a few sector reads), so the chunk can be larger than the
 *  content-hash backfill's — but it still yields, because the thread it runs
 *  on is the one serving the projection window. */
const DECK_CHUNK = 50;

/** Same tolerance as `mergeBinaryTimings`: LibreOffice rounds to whole
 *  seconds, so half a second of disagreement is rounding and a full second is
 *  not. */
const TIMING_AGREEMENT_TOLERANCE_MS = 1000;

let running = false;

export async function backfillDeckTimings(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const repo = getSlidesRepo();
    const decks = repo.decksNeedingTimings();
    if (decks.length === 0) return;

    let decksFixed = 0;
    let slidesFixed = 0;
    let skipped = 0;

    for (let i = 0; i < decks.length; i += DECK_CHUNK) {
      for (const deck of decks.slice(i, i + DECK_CHUNK)) {
        try {
          const stat = await fsp.stat(deck.sourcePath);
          if (
            stat.size !== deck.sourceSizeBytes ||
            Math.trunc(stat.mtimeMs) !== deck.sourceMtimeMs
          ) {
            skipped += 1;
            continue;
          }

          const binary = readBinarySlideTimings(deck.sourcePath);
          if (!binary || binary.length !== deck.slideCount) {
            skipped += 1;
            continue;
          }

          const stored = repo.slideAdvanceTimes(deck.id);
          if (stored.length !== binary.length) {
            skipped += 1;
            continue;
          }

          const updates: { slideIndex: number; advanceMs: number }[] = [];
          let disagreed = false;
          for (const [index, row] of stored.entries()) {
            const fromBinary = binary[index]?.autoAdvanceMs ?? null;
            if (row.advanceMs !== null) {
              if (
                fromBinary !== null &&
                Math.abs(row.advanceMs - fromBinary) > TIMING_AGREEMENT_TOLERANCE_MS
              ) {
                disagreed = true;
                break;
              }
              continue;
            }
            if (fromBinary === null) continue;
            updates.push({
              slideIndex: row.slideIndex,
              advanceMs: Math.max(SLIDES_MIN_ADVANCE_MS, fromBinary),
            });
          }

          if (disagreed) {
            console.warn(
              `[slides] timings backfill skipped, readings disagree: ${deck.sourcePath}`,
            );
            skipped += 1;
            continue;
          }
          if (updates.length === 0) continue;

          const changed = repo.fillSlideAdvanceTimes(deck.id, updates);
          if (changed > 0) {
            decksFixed += 1;
            slidesFixed += changed;
          }
        } catch {
          // Vanished, unreadable, on a drive that went away. The deck keeps
          // whatever it already had; the next launch tries again.
          skipped += 1;
        }
      }
      await new Promise((resolve) => setImmediate(resolve));
    }

    if (decksFixed > 0 || skipped > 0) {
      console.info(
        `[slides] auto-advance backfill: ${slidesFixed} slide(s) across ${decksFixed} deck(s) recovered, ${skipped} skipped`,
      );
    }
  } finally {
    running = false;
  }
}
