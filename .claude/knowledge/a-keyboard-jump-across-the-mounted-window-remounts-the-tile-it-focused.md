## A keyboard jump across a virtualized grid's mounted window remounts the tile it just focused, and focus lands on `<body>`

**Area:** renderer, ui
**Trigger:** `End`, `Home`, or any arrow move that lands far enough away to leave the mounted
window, in `VirtualGrid` (`src/renderer/src/components/ui/virtual-grid.tsx`). The tile gets focus
and loses it a frame later; the roving tabindex is still correct, so nothing in the DOM looks wrong.

- **Believed:** the out-of-window fallback block — the second `RowBlock` that keeps the focused
  row mounted after it scrolls away, added precisely so "focus does not silently fall back to
  `<body>`" — covers the whole move. **False for a move that also scrolls.**

- What actually happens is a two-commit sequence, and the tile is mounted by a **different
  block** in each:
  1. `moveFocus()` sets `pendingFocusRef`, `setFocusedIndex(n)` and scrolls (`scrollTop` is
     written synchronously). The commit that follows still has the OLD `rowWindow`, so row `n` is
     outside it and is rendered by the **fallback** block. The layout effect finds
     `[data-virtual-index="n"] [tabindex="0"]` there, focuses it, and **spends
     `pendingFocusRef`**.
  2. The scroll event's `requestAnimationFrame` runs `recomputeWindow()`, which now includes row
     `n` in the main window. React unmounts the fallback block's node and mounts a new one in
     `RowBlock`'s subtree. Focus goes to `<body>`, and the layout effect re-runs with nothing
     pending.

  Measured on 2026-09-14 against the real app over CDP, on a 176-verse chapter: after `End`,
  `document.activeElement` was `BODY`, `focusedIndex` was `null`, while the grid reported
  `mounted: 12, min: 164, max: 175` and exactly one `[tabindex="0"]` — i.e. the target row **was**
  mounted. Keeping the entry pending instead of spending it does not help: the node it would find
  is the one about to be unmounted.

- **The fix is to remove the intermediate state, not to chase the focus.** `moveFocus()` calls
  `recomputeWindow()` itself, right after `scrollIndexIntoView()`, reading the `scrollTop` it just
  wrote. Both state updates batch into one commit, the tile is mounted by the main block from the
  start, and the node that receives focus is the node that stays. The later rAF recomputes to the
  same window and the setter bails on equality, so there is no second render at all.

- This was a **pre-existing defect of the library grid** (`media-browser.tsx`), found only when
  the same primitive started backing the slide and verse grids — where an arrow key doing nothing
  was the reported bug (`M13`). A virtualized grid's keyboard support is not "arrows move the
  rover": it is arrows, the scroll they cause, and the remount that scroll triggers, all in one
  commit. See also
  [occluded-electron-window-has-no-rendering-lifecycle.md](occluded-electron-window-has-no-rendering-lifecycle.md)
  — the probe that measures this needs a forced frame between the key event and the read.

**Last updated:** 2026-09-14
