## A grid item's default `min-width: auto` overrides its children's `truncate`
**Area:** renderer, ui
**Trigger:** a `truncate` label pushes a trailing button out of view, or an unbreakable long
string (a filename with no spaces) makes a row visually bleed past its column — even though the
label itself has `min-w-0 flex-1 truncate`.

- `truncate` on a label only works if every ancestor between it and the actual sized box (a CSS
  grid track, or a flex container) can itself shrink below its content's min-content size. By
  spec, a grid/flex item's automatic minimum size is its content's min-content size, **not 0**,
  unless the item itself has `overflow` other than `visible` or an explicit `min-width: 0`.
  `min-w-0`/`flex-1`/`truncate` on the *label* alone does nothing if a shell div in between
  (no `overflow-hidden`, no `min-w-0`) still reports `min-width: auto`.
- Concretely: `MediaPanel` (`src/renderer/src/components/ui/media-panel.tsx`) sits directly in a
  CSS grid row (`MonitorsColumn`, `SlidesPanel`) with no explicit `grid-template-columns`. It had
  no `min-w-0`. An audio track title with no spaces (e.g. a filename with underscores, no break
  opportunities) set the *shell's* auto min-width to the title's full min-content length —
  measured live via CDP at 1213px inside a ~450px column — which forced the whole row to expand
  past the column, silently clipped by the ancestor `Panel`'s `overflow-hidden`, taking the
  row's trailing `IconButton` with it into the clipped, unreachable area. The label's own
  `truncate` never got a chance to engage because the box around it had already grown.
- Same failure shape hit `Badge` (`src/renderer/src/components/ui/badge.tsx`) used as a dynamic
  heading pill in a `PanelHeader`'s `flex-wrap` actions row: `Badge` has no `overflow-hidden` of
  its own, so a long heading badge overflowed to ~800px in a ~450px header instead of wrapping
  or shrinking — `flex-wrap` only moves *whole items* to a new line, it does not shrink a single
  oversized item.
- Fix pattern: give the **shell that sits directly in the grid/flex track** `min-w-0` (done on
  `MediaPanel` itself, so every caller — `LiveMediaPanel`, `DeckTransport`, `PreviewMediaBar` —
  gets it for free), and for a `Badge` used as a shrinkable heading, add `min-w-0 flex-1
  truncate` to that specific `Badge` instance (not to the shared component, since most `Badge`
  usages are short fixed pills that shouldn't shrink) while giving any sibling badge `shrink-0`
  so it isn't squeezed by the wrap that no longer happens.
  **Correction (2026-10-22):** `truncate` on the `Badge` itself never showed the «…» — `Badge` is
  `inline-flex`, and the text inside a flex container is an anonymous flex item that cannot
  ellipsize. The text goes in its own `<span className="truncate">` inside the `Badge`; see
  [the shrinking-icon entry](a-shrinking-icon-hides-labels-that-never-fit-and-truncate-needs-a-span.md).
- How this was actually diagnosed: `npm run dev` plus a CDP (`--remote-debugging-port`) client
  driving `Runtime.evaluate` — no macOS Accessibility permission needed. Real service data was
  used, then a synthetic no-space long title was injected via `textContent` to force the
  worst case, and `getBoundingClientRect()`/`getComputedStyle()` on the ancestor chain pinpointed
  the exact element whose `min-width` needed fixing before touching any code.

**Last updated:** 2026-10-22
