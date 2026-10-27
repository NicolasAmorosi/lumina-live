## A theme's system colour is this machine's, not the `lastClr` the file carries

**Area:** slides
**Trigger:** a whole deck tinted (green, grey…) where PowerPoint shows white; `systemColor` in
`src/main/slides/pptx/color.ts`; a theme whose `lt1`/`dk1` is an `a:sysClr`.

- `<a:sysClr val="window" lastClr="C0DCC0"/>` records the colour the system's window colour had on
  the machine that last saved the deck (here a green Windows scheme). PowerPoint paints the
  CURRENT system colour: the 120-slide «Större» template rendered white in PowerPoint and green
  with `lastClr`.
- The reader maps known system colour names to a standard light scheme and uses `lastClr` only for
  a name it doesn't know — in the theme (`readTheme`) and in loose colours alike.

**Last updated:** 2026-10-26
