## Dropping a queued job without settling its promise poisons `inFlight` and makes that asset unusable for the rest of the session

**Area:** slides (`src/main/slides/deck-service.ts`)
**Trigger:** Any report of "this presentation stopped converting and now nothing happens when I
click it", a `deck:ensure` that never resolves, or before touching `cancel`, `cancelAll`,
`setVisiblePrewarm`, `cancelBackgroundJobs` — anything that removes a `Job` from a queue.

Found on 2026-09-11 while auditing the whole media chain. It is the worst defect the audit found,
and it had been latent since the two-queue rework: the cancel path looks complete, and the damage
happens somewhere else entirely.

### What was believed vs. what is true

The belief is that removing a job from its queue plus `controller.abort()` cancels it. It does
not. `cancel()` used to do exactly that and nothing else:

```ts
export function cancel(assetId: number): void {
  const job = inFlight.get(assetId);
  if (!job) return;
  job.controller.abort();
  interactiveQueue.splice(...);     // or removeFromBackground(job)
}                                    // ← no inFlight.delete, no job.reject
```

`abort()` only reaches a job that is **already running** — `runConversion` is what listens to the
signal, and `pump`'s `catch` is what does `inFlight.delete` + `reject`. A job still sitting in a
queue never runs, so **nothing** ever settles it.

Two consequences, and the second is the one that hurts:

1. The promise `deck:ensure` returned never settles. The renderer's `await` hangs forever, and
   `deck.store`'s `pending` map keeps that entry too.
2. **The zombie entry in `inFlight` makes every future `prepareDeck(assetId)` return that same
   dead promise.** Worse, it also disables the up-front cache hit, because that shortcut is
   guarded by `if (!inFlight.has(assetId))` — so even a deck that is fully converted and sitting
   in the cache can no longer be answered. That asset cannot be previewed or projected again
   until the app restarts.

Reachable from the "Cancelar" button in `components/shared/deck-conversion-status.tsx` and from
force-deleting an asset (`services/media-asset-removal.ts` calls `cancel`).

### The rule

**Every path that removes a `Job` from a queue must settle it.** In this file that means
`settleCanceledJob(job, message)`: `inFlight.delete` + `releaseBatchDirFor` + `reject(new
SlideError("CANCELED", …))`. A job that is *running* needs none of it — aborting makes
`runConversion` throw and `pump` cleans up — so the two cases must be told apart by whether the
removal from the queue actually found it:

```ts
if (wasQueued || removeFromBackground(job)) settleCanceledJob(job, "Conversión cancelada.");
```

`setVisiblePrewarm` and `cancelBackgroundJobs` already did the `inFlight.delete` + `reject` pair;
`cancel` and `cancelAll` did not. That asymmetry inside one file is exactly how this survives a
review — the correct pattern is right there, three functions up.

### Corollaries worth remembering

- `releaseBatchDirFor` belongs on the same path. It was missing from all four, so a cancelled
  prewarm left its shared batch temp dir (up to 20 PDFs) on disk until the next startup's
  `sweepCache`, plus stale entries in `precomputedPdfByAsset`/`batchDirByAsset`.
- A cancellation now surfaces to the renderer as `IpcError.code === "CANCELED"`. It is not a
  failure: `deck.store`'s `ensure` maps it to `stale`, not `failed`, or the operator gets a "no se
  pudo convertir" for something they cancelled on purpose. That path only became reachable at all
  once the job started settling.

See also [prewarm LRU grace and linked-audio full-file read](prewarm-lru-grace-and-linked-audio-full-file-read.md)
for the other half of the prewarm queue's history.

**Last updated:** 2026-09-11
