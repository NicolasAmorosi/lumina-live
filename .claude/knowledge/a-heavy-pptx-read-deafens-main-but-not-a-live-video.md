## A heavy `.pptx` read deafens main for seconds, but not a live video — and reading it takes twice what the model alone does
**Area:** slides
**Trigger:** touching `pptx-worker.ts` / `pptx-deck.ts`, moving anything heavy back onto main, or
a report that the control window froze while a deck opened or the library scrolled.

**Last updated:** 2026-10-27

- **Measured** (2026-10-27, M3, the 4 heaviest decks of an 818-deck corpus: marketing templates,
  one with a 22 MB map slide). On main, the model read took 5–6 s, and **`readPresentationMeta`
  took as long again**: it parses every slide a second time, with another parser. That is 11 s
  synchronous. Church decks of the same corpus: 14 ms median, 139 ms max.
- **What it blocked:** a ping sent beside the read waited up to 9.8 s, so the operator's next-slide
  would have reached the projector that late (every change goes through main). **What it didn't
  block:** a 1080p video already live on the projector — 0 `waiting` events, 4 ms worst lag.
  Chromium had buffered enough. Don't argue "it stalls the video": it stalls the operator.
- It was not only the operator's own open. `prepareDeck` reads a source deck *before* any queue,
  so the visible-tiles prewarm (scrolling «Presentaciones») and an import read every new deck
  inline, one after another.
- **The fix that works:** a `worker_threads` worker via electron-vite's `?nodeWorker`. It runs the
  model and the meta together and returns each slide's `layers` **already as a JSON string**: a
  `structuredClone` of the heavy models costs 70–120 ms, strings almost nothing. After the change,
  the ping waited 6–101 ms. It runs from inside the packaged `app.asar`: `decks.spec` +
  `native-decks.spec` passed 18/18 against the `.app`. The worker's chunk shares
  `native-deck-*.js` with main, so check that chunk never imports `electron`.
- A worker that dies (`error`/`exit`) resolves its pending reads to `null` → LibreOffice. **Never
  retry such a file on main**: the file that killed a thread would kill the app.
