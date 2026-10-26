## pdf.js ignores ICC profiles, so a PDF PowerPoint exported paints its gradients far too dark

**Area:** slides
**Trigger:** a PDF deck (or a PowerPoint reference PDF) whose gradients look much darker than in
PowerPoint; anything that rasterizes PDFs with `pdfjs-dist` (`rasterizer.ts`, the release-check
harnesses).

- PowerPoint (for Mac, 16.112, measured 2026-10-26) writes each two-stop gradient as a
  `ShadingType 2` whose colour space is `[/ICCBased …]` with the **"Generic RGB Linear Profile"**
  (gamma 1.0, `rTRC` a single 1.0 entry). pdf.js, as the app loads it (no `wasmUrl`/ICC module),
  falls back to the profile's `/Alternate /DeviceRGB` and reads those linear values as sRGB.
- Measured on one slide: Quartz paints the gradient's ends (0,105,203) / (0,48,99) — the deck's
  own colours; pdf.js paints (0,34,156) / (0,7,30), each channel raised to ~2.2.
- Consequences: (1) a reference for comparing renders must be rasterized by something that honours
  ICC — `tools/release-checks/pptx-render/pdf2png.swift` uses Quartz; (2) PDF decks exported from
  PowerPoint that the app projects through pdf.js show the same darkening today, until the PDF path
  gets ICC support or another rasterizer.

**Last updated:** 2026-10-26
