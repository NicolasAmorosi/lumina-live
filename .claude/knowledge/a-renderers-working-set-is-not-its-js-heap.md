## A renderer's working set is not its JS heap: measure the heap after a forced GC before blaming a cache
**Area:** renderer
**Trigger:** a memory number from `app.getAppMetrics()` / Activity Monitor that looks like a
leak, or adding a cap, LRU or eviction to a renderer-side cache.

**Last updated:** 2026-10-27

- The control window's `workingSetSize` went from 133 MB to 924 MB after five heavy model decks,
  and `lib/slide-models.ts`'s `ready` map, which never evicts, looked guilty. A byte-budget LRU was
  written for it. **Measured properly, it changed nothing.** The control window's JS heap after a
  forced GC was 19 → 87 → 15 → 16 → 17 MB with the LRU, and 19 → 87 → 15 → 16 → 17 MB without it.
  The working set is decoded images, GPU/compositor memory and the DOM, which Chromium manages
  itself. The LRU was reverted.
- How to measure, in a Playwright probe against the app:
  `const cdp = await page.context().newCDPSession(page)`, then
  `await cdp.send("HeapProfiler.collectGarbage")` and
  `(await cdp.send("Runtime.getHeapUsage")).usedSize`. Compare with and without the change, the
  same scenario.
