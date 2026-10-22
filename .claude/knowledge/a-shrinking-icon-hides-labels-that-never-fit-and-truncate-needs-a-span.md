## A shrinking icon hides labels that never fit, and `truncate` on a flex container never shows «…»
**Area:** ui
**Trigger:** an icon looks smaller than its siblings in a tight row; a label is cut mid-letter with
no ellipsis; adding a primitive that puts text next to an `Icon`; or touching a fixed-width control
(`w-24` and friends) that holds an icon and a label.

- `Icon` (`src/renderer/src/components/ui/icon.tsx`) had no `shrink-0`, and 157 of its 169 call
  sites never added one. A lucide `<svg>` is a flex item with `flex-shrink: 1` and a min-content
  width of 0, so in any squeezed row it was the FIRST thing to give way: the resource tabs at
  1000 px drew «Presentaciones» in full next to an icon squashed to a sliver (2026-10-22 report).
  `shrink-0` now lives in `Icon` itself; the 12 hand-written copies were removed.
- The shrinking icon was also MASKING labels that never fit. The TopBar's LOGO/NEGRO/VIVO buttons
  are `w-24` (96 px); «NEGRO» with its icon, `gap-2` and `px-3` needs ~99 px. It was 3 px short at
  EVERY window width and nobody saw it, because the icon absorbed the difference. Fixing the icon
  turned it into «NEG…» — fixed with `px-2`, not by widening (three 104 px buttons no longer fit
  the TopBar's third column at the 1000 px `minWidth`). After any change that stops something from
  shrinking, re-measure the fixed-width controls around it.
- `truncate` (`text-overflow: ellipsis`) applies to block containers. On a `flex`/`inline-flex`
  element its bare text child is an ANONYMOUS flex item, so the text is clipped mid-letter and the
  «…» never appears. That was the state of `Tabs` (`truncate` on the tab button), `Button`
  (children straight into an `inline-flex` span) and the two heading `Badge`s in
  `MonitorsColumn`/`SlidesPanel`, which [the grid-item entry](grid-items-need-min-w-0-to-let-truncate-work.md)
  had prescribed as `<Badge className="min-w-0 flex-1 truncate">`. The text must be in its own
  `<span className="truncate">`: `Tabs` wraps the label, `Button`'s `truncateText()` wraps every
  run of string children (merging adjacent strings, dropping whitespace-only runs — wrapping the
  `" "` of `<Icon /> {label}` would add a phantom gap).
- `tailwind-merge` drops a base `shrink-0` when the call site passes `flex-1` (measured:
  `twMerge("shrink-0 …", "flex-1")` → no `shrink-0`), which is why `Badge` can carry `shrink-0` as
  its default and the heading badges still shrink.
- Detector, run against the built app via Playwright `_electron` at 1000 px (`control-window.ts`'s
  `minWidth`) and at a normal width: any `<svg>` whose bounding rect is not square is a squeezed
  icon (lucide glyphs are square); any element with computed `text-overflow: ellipsis` and
  `scrollWidth > clientWidth` is a cut label; an `overflow: hidden` leaf with text and
  `scrollWidth > clientWidth` but no ellipsis is a clipped one. After the fix: zero squeezed icons
  on every screen, and «Presentaciones» the only label still cut at 1440 px — kept equal-width by
  the owner's choice, with a `title` set on hover only when the label is actually cut.

**Last updated:** 2026-10-22
