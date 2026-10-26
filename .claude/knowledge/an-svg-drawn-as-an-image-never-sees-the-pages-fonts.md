## An SVG drawn as an image never sees the page's fonts, so a metafile's text falls back off Windows
**Area:** slides
**Trigger:** text inside an EMF/WMF picture (served as SVG by `metafileToSvg`, `src/main/slides/pptx/metafile.ts`) renders in the wrong face; any idea of fixing it by registering a font in the window

- A metafile reaches the slide as `<image href="worship://deck/<id>/part/…emf">` whose body is an
  SVG. An SVG loaded as an image is rendered as an isolated document: it cannot use the
  `@font-face`/`FontFace` fonts the page registered (the bundled metric twins in `slide-fonts.css`,
  the deck's embedded fonts) — only fonts installed on the system. It cannot fetch anything either,
  which is why its bitmaps are `data:` URIs.
- Measured 2026-10-26: Calibri text inside metafiles falls back to Helvetica on this Mac (glyphs
  placed right per the advance array, but wider). On Windows Calibri is a system font and it is
  right. `metafileToSvg` lists Carlito/Liberation/Caladea after each face, which only helps where
  those are INSTALLED (common on Linux).
- To fix it for real, the text has to stop depending on fonts inside the image: inline the SVG into
  the slide's DOM instead of `<image>`, or turn the glyphs into paths. Registering one more font in
  the window changes nothing.

**Last updated:** 2026-10-26
