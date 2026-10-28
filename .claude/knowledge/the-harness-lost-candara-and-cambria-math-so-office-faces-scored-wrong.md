## The harness lost Candara and Cambria Math, so slides in Office faces scored wrong that Windows draws right

**Area:** slides
**Trigger:** a «wrong» slide whose text is in an Office face that Windows ships (Candara, Consolas,
Cambria Math…), or reading the corpus numbers as what a church PC would show;
`tools/release-checks/pptx-render/harness.cjs` (maintainer workspace).

- The harness registers PowerPoint for Mac's ~280 bundled fonts as `FontFace`s so the score measures the
  renderer as on Windows. Chromium's sanitizer (OTS) refused 11 of them — Candara and Consolas for an
  empty `prep` table, Bell MT and Batang for their `cmap` —, and the harness skipped every `.ttc`
  (Cambria Math lives in `cambria.ttc`). Those slides fell back to Helvetica and scored as renderer
  bugs: a real Lutheran liturgy in Candara was the corpus's worst deck (coarse up to 80).
- On Windows these are system fonts and are never sanitized, so the app was already right there. The
  harness now serves each Office font rebuilt without its zero-length tables, and each member of a
  `.ttc` on its own; the liturgy dropped 45–69 points per slide. Bell MT and Batang still fail.
- A different gap is real on every platform: faces PowerPoint 365 fetches as cloud fonts and decks
  name without embedding (Open Sans, Montserrat with its per-weight family names, Source Sans Pro).
  Those now ship with the app (OFL, `assets/fonts/slides/`); Arimo/Tinos/Cousine are metric twins of
  Arial/Times/Courier. Agency FB and Matura MT are Office faces with no open twin: right on a PC with
  Office, a fallback elsewhere.

**Last updated:** 2026-10-28
