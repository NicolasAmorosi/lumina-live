## Tailwind's `ring-offset` paints its gap white, so on a dark theme every focused control had a white halo
**Area:** ui
**Trigger:** writing a focus style; seeing `focus-visible:ring-offset-*`; a 1px light line around a focused control on the dark theme.

- Believed: `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1` draws a ring
  with a transparent gap. True: the offset is a second box-shadow painted in
  `--tw-ring-offset-color`, whose registered initial value is `#fff`
  (`node_modules/tailwindcss/dist/lib.js`). Seven primitives (`Button`, `IconButton`, `Input`,
  `Textarea`, `Select`, `Switch`, `ColorField`) used it and none set an offset colour, so on the
  dark theme — the default, used in a dark booth — each focused control got a 1px white halo
  between it and the ring. When checking focus over CDP, mind
  [element-click-over-cdp-fakes-focus-visible-and-invents-focus-only-bugs.md](element-click-over-cdp-fakes-focus-visible-and-invents-focus-only-bugs.md).
- An `outline` has no such problem: the gap of `outline-offset` is transparent and shows whatever
  surface is behind, in either theme. Found by comparing with libretto-villaaurora, which hit the
  same thing and sets an explicit offset colour per surface instead.
- Rule now: focus is the `focus-ring` / `focus-ring-inset` utility in `styles/globals.css`
  (`outline: 2px solid var(--color-ring)`, offset `2px` / `-2px`). Never `ring-offset-*`. The
  `-inset` form is for anything inside a box that clips overflow (tab strips, tile grids, listbox
  options), where an outer outline would be cut off.

**Last updated:** 2026-10-22
