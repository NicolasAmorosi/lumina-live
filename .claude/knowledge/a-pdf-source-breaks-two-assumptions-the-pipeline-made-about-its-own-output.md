## A PDF *source* breaks two assumptions the pipeline made about its own output

**Area:** slides (`main/slides/deck-service.ts`, `main/slides/pptx-metadata.ts`,
`renderer/src/rasterizer.tsx`)
**Trigger:** Adding or debugging a deck whose source is a PDF; any text that renders blank or
wrong in a rasterized page; anyone proposing to "just let LibreOffice handle it uniformly".

Found in the 2026-09-20 session, while adding PDF support. The pipeline is
`source → PDF → one image per page`, so a PDF looks like it should just slot into the middle.
It does — but two things in the code were quietly written for *PDFs we produced ourselves*, and
both are wrong for one the operator imported.

### 1. Running a PDF through `soffice` re-renders it through Draw

`--convert-to pdf` on a `.pdf` input does **not** pass it through. LibreOffice says so itself:

```
convert .../in.pdf as a Draw document -> .../out/in.pdf using filter : draw_pdf_Export
```

Measured on a real file (`holy-forever-…pdf`): **157.099 bytes in, 1.760.224 bytes out** — 11×,
because every glyph went through Draw's PDF *importer* and came back as Draw's idea of the same
page. That is a fidelity loss, not just wasted time.

So `runConversion` short-circuits: `containerKind(sourcePath) === "pdf"` ⇒ `pdfPath =
sourcePath`, straight to `rasterizePdf`. `warmBatchPdfCache` filters PDFs out of
`convertBatchToPdf` for the same reason. Two consequences worth knowing:

- **A PDF deck needs no LibreOffice at all.** That is why `deckRequiresSoffice(ext)` exists in
  `shared/constants.ts` and why the "instalá LibreOffice" gate in `deck-slides.tsx` and the
  "Preparar carpeta" button in `media-browser.tsx` are per-deck, not global. A gate on the
  environment flag alone refuses work that has no such dependency.
- `consecutiveTimeouts = 0` moved inside the `else`: it tracks LibreOffice health, and a deck
  that never launched it must not clear a streak of real `soffice` timeouts.

### 2. `useSystemFonts: false` silently loses every non-embedded standard font

`rasterizer.tsx` passed `useSystemFonts: false` with the comment *"LibreOffice embeds/subsets
every font into the PDF, so pdf.js should never reach for a system font here"*. True — for a PDF
we just produced. An imported one can reference the base 14 (Helvetica, Times, Courier) without
embedding them, and pdf.js then renders **nothing**:

```
Warning: UnknownErrorException: Ensure that the `standardFontDataUrl` API parameter is provided.
```

Measured against a hand-built PDF whose only font is non-embedded `/Helvetica`:
`useSystemFonts: false` → that warning and no glyphs; `useSystemFonts: true` → **no warning at
all**, resolved from the OS. It changes nothing for a deck we converted, because an embedded font
is always used from its embedded data regardless of this flag.

The deterministic alternative is shipping `pdfjs-dist/standard_fonts/` (816 KB, 16 `.pfb`) and
setting `standardFontDataUrl`. It was **not** done, and the reason is worth recording: the fonts
would need a `publicDir` copy step, and `rasterizer.html`'s CSP is `default-src 'none';
connect-src worship:` — pdf.js fetches that data, so the policy would have to be widened for both
the dev-server origin and the packaged `file://` one. Reach for it only if a real PDF turns up
whose missing font is *not* one of the base 14.

### 3. The `worship://raster/` guard answered 403 for every PDF source

The one that no `typecheck`/`lint`/`test` would ever have caught, because it lives in a
capability check three files away from the change:

```ts
if (!resolved.startsWith(slidesTempDir + path.sep)) return new Response("Forbidden", { status: 403 });
```

That prefix was a correct proxy for "main vetted this path" for exactly as long as every PDF the
rasterizer ever read was one main had just written into its own temp dir. A PDF *source* lives
wherever the operator keeps it, so every one of them would have failed with
`No se pudo leer el PDF (403)` — a conversion error with nothing in it pointing at a protocol
guard.

The fix is a **positive** assertion rather than a widened prefix: `MediaRepo.hasPath(resolved)`,
matched on `pathKey` (NFC + lowercased on Windows). "The operator added this file to the library"
is the same property `worship://asset/<id>` already rests on, so the route keeps a real check
instead of a comment. Do not relax it to a directory prefix of the source folder.

### 4. Page geometry is no longer uniform, and no longer always landscape

Every Impress/PowerPoint slide is landscape, so scaling by width alone (`targetWidth /
viewport.width`) always bound the result. A PDF page is not: a real one here
(`Guida dello studente…pdf`) is 72 pages at `841×594` with `/Rotate 90`, and a letter-portrait
page scaled by width alone renders **1920×2485** to be shown letterboxed at roughly 834 px wide
on a 16:9 projector — 2,3× the pixels anyone can see, paid for in cache on every page.

The fix is `Math.min(targetWidth / width, targetWidth / height)` — fit into a square. It is
provably a no-op for anything landscape (verified: the 72-page landscape file renders
`1920×1356` before and after), which is why **no `SLIDES_CONVERTER_VERSION` bump was needed** and
the user's 1235 cached decks were not invalidated. Portrait pages drop from `1920×2485` to
`1484×1920`.

Two smaller facts from the same area:

- `page.getViewport({ scale })` already applies the page's `/Rotate`, so the rotated file needs
  no special handling.
- `slide_decks.aspect_ratio` is a single value per deck and a mixed-size PDF has none. It is
  `null` for a PDF — harmless, because that column is **written and never read** anywhere.
- An encrypted PDF throws `PasswordException` from pdf.js. The rasterizer window reports a coarse
  `kind: "password"` (it does not know `SlideErrorCode`) and main maps it to the new
  `PDF_PASSWORD`, so it stops being an unexplained `RASTER_FAILED`.

**Last updated:** 2026-09-20
