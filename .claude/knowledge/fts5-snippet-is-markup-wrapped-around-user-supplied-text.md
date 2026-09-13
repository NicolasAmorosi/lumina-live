## FTS5's `snippet()` is markup wrapped around user-supplied text — rendering it as HTML hands an imported bible file the whole IPC bridge

**Area:** data (`src/main/db/repositories/bible.repo.ts`) | renderer (`pages/resources/bible-browser.tsx`)
**Trigger:** Before using `dangerouslySetInnerHTML` anywhere, before adding highlighted search
results, or when changing what `bible:search` returns.

Found on 2026-09-11 during the media-chain audit. Nothing about it looks dangerous at either end,
which is the point: the danger is in the seam.

### The chain

1. `bible:import` lets the operator pick **any** JSON file and seeds it as a bible version. Church
   bible files travel on USB sticks and chat apps — this is untrusted input with a friendly name.
2. `search()` asked SQLite for `snippet(bible_verses_fts, 0, '<mark>', '</mark>', '…', 12)`. FTS5
   builds that string by wrapping the delimiters around **the stored text, verbatim**. It escapes
   nothing; it has no idea the delimiters are HTML.
3. The renderer painted it with `<span dangerouslySetInnerHTML={{ __html: hit.snippet }} />`.

So a verse containing `<img src=x onerror=…>` ran script in the control window. And the control
window holds the deliberately generic preload bridge (`window.worship.invoke(channel, req)`), so
that script reaches **every IPC channel in the app** — deleting library rows, writing settings,
driving the projector. `contextIsolation`/`sandbox` do not help: the payload runs inside the page
that legitimately owns the bridge.

### The fix, and the rule

The snippet stopped being markup. FTS5 now delimits with `char(1)`/`char(2)` — code points that
cannot be markup in any context — and `parseSnippet()` (`src/shared/types/bible.ts`) turns the
string into `{ text, match }` segments that `HighlightedText` (`components/ui/`) emits as real
React elements. Nothing is ever interpreted.

Rules to keep:

- **No `dangerouslySetInnerHTML` in this repo.** There is now zero, and `db:smoke` step 5 asserts
  that a snippet never contains `<`.
- **A highlight primitive takes segments, not a string with markup in it.** That is what makes the
  unsafe version unrepresentable rather than merely discouraged.
- The bridge being generic is a deliberate, good design (see `preload/index.ts`'s comment) — but
  it means *any* script execution in the control window is full compromise. Weigh renderer XSS
  accordingly, even in a local single-user app.
- SQLite's `char(1)`/`char(2)` is how you pass a control character as an FTS5 delimiter from SQL;
  writing the literal byte into the `.ts` source works too but is invisible in an editor and does
  not survive a careless copy-paste. In TypeScript use `"\u0001"`/`"\u0002"`.

**Last updated:** 2026-09-11
