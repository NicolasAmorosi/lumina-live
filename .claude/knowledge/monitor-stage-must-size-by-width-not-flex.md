## The monitor stage must size itself from its own width, never from leftover flex height
**Area:** ui, renderer
**Trigger:** touching `components/ui/monitor.tsx`, `MonitorsColumn.tsx`, `SlidesPanel.tsx`, or adding anything that renders "under" a LIVE/PREVIEW monitor (a transport, a status bar, a track row)

- `Monitor` used to render its 16:9 stage as `flex-1 items-center justify-center` inside a grid row templated `1fr`, with `aspect-video max-h-full` on the inner box. That makes the stage's rendered size a function of *whatever height is left in its row* — which is not the same in both columns, and not stable even within one column.
- Two symptoms this caused: (1) LIVE and PREVIEW monitors rendered at different heights/vertical positions, because `MonitorsColumn`'s grid had a different row/gap count than `SlidesPanel`'s (an `auto` row for `LiveMediaPanel` that PREVIEW doesn't have); (2) whenever a PPT deck was live, `LiveMonitor` passed `DeckTransport` as `Monitor`'s `footer` prop, so the transport rendered *inside the same flex-1 row as the stage* and visibly shrank the live rectangle — a plain video (no transport) stayed full-size, a deck did not.
- Fix: `Monitor` (`src/renderer/src/components/ui/monitor.tsx`) no longer takes a `footer` prop and no longer stretches to fill a flex row. Its stage is `w-full aspect-video` with no `max-h-full`/`flex-1` — height always follows width, full stop. Both `MonitorsColumn` and `SlidesPanel` changed their monitor's grid row from `1fr` to `auto` so the row is sized by the stage's own aspect ratio, not by the flex layout. `DeckTransport` moved out of `Monitor` entirely and is now a sibling grid row in `MonitorsColumn`, exactly like `LiveMediaPanel` already was.
- Consequence: anything that needs to render below a monitor (transport, media bar, status) **must** be its own sibling row in the column's grid, never a prop passed into `Monitor`. Passing it as a prop re-couples the stage's size to that sibling's presence and reintroduces both bugs. Since the three-column layout (`AppShell.tsx`) is equal-width, sizing purely by width is also what keeps LIVE and PREVIEW pixel-identical without needing to match grid row counts between the two columns.
- **"Equal-width" was false until 2026-10-22, and sizing by width made that visible.** `<main>` was `grid-cols-3 divide-x divide-border`. Tailwind v4's `divide-x` is `border-inline-end: 1px` on every child *but the last*, i.e. a border INSIDE the column: the three tracks were equal, their content boxes were not. Measured at a 1600px window: centre column content 532.3px, live 533.3px → PREVIEW stage 484.3×272.4 vs LIVE 485.3×273.0, and the transport rows under them 508.3 vs 509.3 wide, the left one 0.56px higher. The operator saw it as "one bar is lower and smaller than the other" (the verse rows, Génesis 1:1). Fix: `grid-cols-3 gap-px bg-border` — the rule is the grid's background showing through a 1px gap, which sits *between* tracks, so all three content boxes are identical (verified 0.00px apart at 1280 and 1600; 0.01px of `fr` rounding at 1437). Never put `divide-x`/a border on one column of a set that has to mirror another.
- The stage's border (added the same day so a projected picture the colour of the app doesn't melt into the panel) goes on an OUTER box, with `aspect-video` on the inner one. On the `aspect-video` box itself, `border-box` sizing would leave a (W−2)×(H−2) picture that is no longer 16:9 — slightly off from the projector it mirrors. Measured after the fix: stage 484.67×273.5, picture 482.67×271.5 = 16:9 exactly.

**Last updated:** 2026-10-22

### Drifted apart again by 2026-10-23 — three ways a row stops matching its twin

The operator saw the PREVIEW and LIVE rows under the monitors at different heights for every kind
of content but a verse. Measured at 1280 px (row top / left in its column / width / bar top):

```
video   PREVIEW 360.5 / 12 / 442 / 415.5    LIVE 366.5 / 18 / 424 / 401.5
deck    PREVIEW 366.5 / 18 / 424 / —        LIVE 360.5 / 12 / 442 / —
```

- `LiveMediaPanel` had moved INSIDE the live `PanelBody` (`p-1.5` + `scrollbar-gutter: stable`) —
  6 px lower, 18 px narrower — and the deck's soundtrack strip (`DeckAudioStrip`) lived inside
  PREVIEW's, the same mistake mirrored. Both are siblings of the monitor again; the media panel
  bounds itself (`max-h-[40%] overflow-y-auto`) instead of relying on the scroll area. The live
  column is a flex column like PREVIEW's: its old `grid-rows-[auto_auto_auto_minmax(0,1fr)]` put
  the body in an `auto` track whenever a transport rendered `null`, and kept the empty tracks' gaps.
- PREVIEW's video/audio row carries a hint («Sin sonido…») its LIVE twin doesn't: above the bar it
  put that bar 20 px lower. Hints and errors are a row's LAST line now.
- An `xs` `Button` is `h-7`, an `xs` `IconButton` `size-6`: a row with a text button (a plate's GO
  LIVE, the deck strip's «Asignar») was 4 px taller than its twin. Those buttons carry `h-6`.

`Monitor` gained `shrink-0` with the flex column: `overflow-hidden` makes a flex item's automatic
minimum height 0, so the column with more rows would squeeze its stage first. Guarded by
`media.spec.ts` › «the row under PREVIEW and the row under LIVE line up» (verified failing on the
old code: `dy 6, dx -12, dBar -14`).

**Last updated:** 2026-10-23
