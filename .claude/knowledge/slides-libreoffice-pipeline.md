## Slide pipeline gotchas (LibreOffice + pdf.js)

**Area:** main | slides
**Trigger:** Touching deck conversion, OOXML timing parsing, or debugging why a deck has no
auto-advance / wrong slides.

- **LibreOffice does NOT export hidden slides to the PDF.** Verified against a real deck: 4 OOXML
  slides with one `p:sld/@show="0"` produced a 3-page PDF. Timings must therefore be aligned
  against the VISIBLE slides (`!hidden`), not the full `sldIdLst` — matching the full list shifts
  every timing by one per hidden slide. If the counts still disagree, ALL timings are dropped
  (`timings_source='none'`): misaligned auto-advance is worse than none.
- **`soffice --convert-to png` only exports the first slide** of a presentation. The pipeline must
  go through PDF.
- **The filter name must not be quoted** in the argv array: `"pptx:Impress MS PowerPoint 2007 XML"`,
  not `'pptx:"Impress MS PowerPoint 2007 XML"'`. Literal quotes become part of the filter name and
  LibreOffice fails with `SfxBaseModel::impl_store ... Error Area:Io Class:Parameter Code:26`.
- **Use pdf.js's LEGACY build** (`pdfjs-dist/legacy/build/pdf.mjs`). The modern bundle calls newer
  JS built-ins (e.g. `Uint8Array.prototype.toHex`) that Electron 36's Chromium lacks, failing at
  runtime with the useless `n.toHex is not a function`.
- **`<p:transition>` usually isn't a direct child of `p:sld`** in decks made by modern PowerPoint:
  it lives in `mc:AlternateContent/mc:Choice[@Requires="p14"]`, with a copy in `mc:Fallback`.
  Check Choice → Fallback → bare, or you silently read zero timings.
- **Legacy binary `.ppt`/`.pps` round-trip works, but NOT for every timing**: a second
  `--convert-to pptx` pass recovers structure and embedded audio (verified on a real 52-slide
  `.ppt`) — and silently loses `advTm` on any slide with no visual transition effect, because
  LibreOffice's PPTX export only writes the `<p:transition>` element that attribute lives on when
  there is an effect to write. The times are re-read from the source binary instead; full
  diagnosis in
  [libreoffice-pptx-export-drops-advtm-without-a-transition-effect.md](libreoffice-pptx-export-drops-advtm-without-a-transition-effect.md).
- electron-vite does **not** always restart the main process on a file change — if a main-side fix
  seems to have no effect, restart `npm run dev` before assuming the code is wrong.

**Last updated:** 2026-09-13
