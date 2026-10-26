## A slide's `masterIdRef` is the master's `slideId`, not a persist id

**Area:** slides
**Trigger:** reading a legacy `.ppt`/`.pps` master (background, master objects, a shape's
`hspMaster`) in `src/main/slides/ppt-binary.ts`; a master lookup that silently finds nothing.

- **The belief this replaces:** `SlideAtom.masterIdRef` (offset 12) is a persist id, so
  `persistOffsets.get(masterIdRef)` gives the master's container. The 2026-10-25 spike
  (`pps2html.mjs`) did exactly that, and every lookup missed — it reported «0 visible master
  objects» for the whole hymnal, which looked like a finding and was a bug.
- **What it is:** the master's `slideId`, the one in its `SlidePersistAtom` (offset 12) inside the
  `SlideListWithText` with **`recInstance` 1** (0 = slides, 1 = masters, 2 = notes). Map
  `slideId → persistIdRef` from that list, then persist id → offset as usual (`masterPersistIds`
  in `openDocument`). Real hymnal values are `0x80000000`-range, never a small persist id.
- **How it surfaced:** 20 decks (201–209, 250, in both folders) were refused as «not covered by a
  picture» although every slide was a full-slide JPEG: their covers inherit `fLine` from the
  master's body placeholder (`hspMaster` = 0x403), and with the master not found the line was
  «not said anywhere». Fixing the lookup took the refusals from 22 to 2.

**Last updated:** 2026-10-26
