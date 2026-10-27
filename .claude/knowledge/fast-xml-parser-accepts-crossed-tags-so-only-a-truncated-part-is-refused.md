## fast-xml-parser accepts crossed and unclosed tags, so only a part cut mid-tag counts as unparseable
**Area:** slides
**Trigger:** deciding when a `.pptx` part "won't parse" (`pptx/xml.ts` `parseXml`, `reader.ts`
`level()`), writing a test with a broken slide, or a corrupt deck that comes out blank instead
of going to LibreOffice.

**Last updated:** 2026-10-27

- `parseXml` returns `null` only when `XMLParser.parse` throws, and it almost never does. These all
  **parse**, into some tree: `<p:sld><<<p:cSld>…</p:sld>`, a closing tag that crosses another
  (`<a><b></a>`), and a root that never closes. What throws is **a tag cut in the middle**
  (`…<p:cNvPr id="4" na`), the shape a truncated download or a damaged part leaves. A test of
  "unparseable slide" has to use that, or it passes for the wrong reason. Two attempts failed
  before this was clear.
- Before 2026-10-27, an unparseable slide was drawn as an empty slide (background only), in
  silence. Now `level()` refuses the deck when a slide, layout or master is in the zip but parses
  to `null`, so it goes to LibreOffice. Across the 818-deck corpus that changes exactly two decks,
  both oss-fuzz cases from LibreOffice's own `fail/` folder.
- **Don't widen it to every part.** 10 corpus decks (LibreOffice's ActiveX tests) carry a `.vml`
  that doesn't parse, and losing one legacy drawing must not cost the deck its model.
