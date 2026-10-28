# 03 — Slide pipeline (model decks, native decks, and headless LibreOffice)

Completely replaces the COM/PowerShell integration with PowerPoint. There is **no** longer anything
Windows-only: the app runs and is validated the same way on macOS, Windows and Linux. Since
2026-10-26 neither a `.pptx` (*Model decks*, below: read and drawn by the app itself) nor a legacy
deck made of pictures — the hymnal (*Native decks*) — goes through LibreOffice. What still does: an
`.odp`, a legacy `.ppt`/`.pps` with text, and a `.pptx` that won't open as a presentation.

## The model change

Before: *remote control of a live PowerPoint slideshow* — main held a slide cursor, PowerShell
moved it, and the PNGs were an ephemeral byproduct in `os.tmpdir()`.

Now: **a deck is content**. It is converted once and cached; main no longer has a slide cursor, it
has a **cache**. That reframing alone is what deletes `ppt:next/prev/goto/
currentSlide/close` — the cursor lives in the renderer's store and it is the only copy.

## The pipeline

```
.pptx ──soffice --convert-to pdf──► PDF ──pdfjs in a hidden window──► WebP per slide
   │                                                                      │
   └──OOXML parsing (fflate + fast-xml-parser)──► timings + audio ────────┴──► SQLite + disk
```

`soffice --convert-to png` **only exports the first slide** — hence the detour through PDF.

## Model decks: a `.pptx` is drawn, not converted (2026-10-26)

Any OOXML presentation (`.pptx`, `.pptm`, `.ppsx`, `.ppsm` — decided by the container,
`containerKind === "ooxml"`, not the extension) is read into a **model of what to paint** per
slide and drawn in the renderer by `SlideView`. No LibreOffice, no PDF, no images on disk:

```
.pptx ──slides/pptx/ (reader.ts: theme, master, layout, slide)──► SlideModel per slide ──► SQLite (deck_slides.layers)
                                                                                              │
SlideView (React, components/shared/slide-view/) ◄── worship://deck/<id>/<n>/model ◄──────────┘
        └── pictures, metafiles (as SVG) and embedded fonts ◄── worship://deck/<id>/part|font/<part>, read from the .pptx
```

- **The owner's decisions** (2026-10-26): the switch is **total** — a deck is never drawn half by
  the model and half by LibreOffice, and what the model can't draw exactly (3D bevels, artistic
  effects, a SmartArt without its drawing) is **approximated, never refused**. The reference for
  "right" is PowerPoint, LibreOffice second. Fidelity is measured against PowerPoint's own
  rendering, slide by slide, and improved in place; `SLIDES_MODEL_VERSION` is bumped when the
  reader changes what it puts in a model, so every model deck is read again.
- **What is read** (`src/main/slides/pptx/`, entry `pptx-deck.ts`): the XML parts and relationships
  only, through `readZipEntries`, **on a worker thread** (`pptx-worker.ts`, started with the first
  deck through electron-vite's `?nodeWorker`). It reads the model and `readPresentationMeta`
  together — each parses every slide again, and on a template with a 22 MB map slide the two
  took 11 s on the thread that answers IPC and serves `worship://` — and hands back each slide's
  `layers` already as JSON, so main only pays for copying strings. A worker that dies on a file
  sends that deck to LibreOffice; it is never retried on main. The preset geometries and the built-in table styles come from
  `resources/ooxml/` (`paths.ts` → `ooxmlDir`, shipped as `extraResources`). Pictures, media and
  fonts are never read here — the model names them by part.
- **What is stored**: a `slide_decks` row with `image_format = 'model'`, `render_width = 0`,
  `converter_version = SLIDES_MODEL_VERSION`; one `deck_slides` row per visible slide whose `layers`
  column is the `SlideModel` JSON (median 6.5 KB, but a slide with a big table or chart can be
  megabytes — that is why it is served by url and never inlined in a DTO). `cache_dir` is `''`
  unless the deck embeds sound or video, which are still extracted there exactly as for a converted
  deck (`ponytail:` until the media engine serves them from the `.pptx` by range). Timings,
  transitions, sound and video come from the same `readPresentationMeta` a converted deck used,
  aligned by visible position; when the counts disagree the timings go.
- **What is served**: `…/<n>/model` is the JSON; `…/part/<part>` is a picture as is, or an
  EMF/WMF (or its gzipped `.emz`/`.wmz`) as the SVG `metafileToSvg` makes of it — Chromium decodes
  neither; `…/font/<part>` is an embedded font (EOT / MicroType Express) rebuilt as TrueType by
  `decodeEmbeddedFont`. All `immutable`, and all 410 once the source is no longer the file the model
  was read from. A model slide's `url`/`thumbUrl` serve no image: `modelUrl` (on `DeckSlide`, the
  `slide` output and `DeckStatusSummary`) is what draws it, and every consumer — `OutputView`, the
  two slide grids, the library tile — checks it first.
- **In the renderer**: `lib/slide-models.ts` fetches a model once per window and hands it out only
  once the deck's embedded fonts are registered and its pictures decoded, so the projector never
  shows a fallback face or a picture arriving late; `OutputView`'s preload warms the neighbours
  through it. `ModelSlide` fits the slide into its box the way `object-contain` fitted the image.
  Faces a deck names but this machine lacks fall back to bundled metric twins (Carlito, Caladea,
  Liberation, `assets/fonts/slides/`); the open faces PowerPoint 365 fetches as cloud fonts (Open
  Sans, Montserrat, Source Sans Pro, with their per-weight family names) ship there as themselves.
  Office faces with no open twin (Candara, Agency FB…) are right on a PC with Office and a fallback
  elsewhere.
- **What the show hides stays hidden**: a sound or video set to «Hide during show» (its media node
  in `p:timing` says `showWhenStopped="0"`) is left out of the model, as the legacy reader leaves
  out the speaker icons `fHide` marks. PowerPoint's own PDF export still draws them: it is not the
  reference for this.
- **Sounds play on their own slides** (owner, 2026-10-27): each sound is placed by
  `placeAudio` on the deck's visible slides from its media node's `numSld` — 1 when absent, which
  is «this slide only», 999 for «play across slides»; whether it loops is that node's too, never
  guessed. The one that plays from the first slide to the end is the deck's `soundtrack` (the
  clock `deck-autoplay.ts` follows); every other one is in `DeckDTO.sounds` and
  `effects/deck-sounds.ts` plays it. A converted deck's sounds are placed the same way, by page.
- **Unreadable**: a file that won't open as a presentation (or whose slides are all hidden) is
  remembered by `(size, mtime)` and goes to LibreOffice as before. So does one whose slide, layout
  or master is in the zip but won't parse: drawn, it would be an empty slide in silence. Only those
  three parts — a `.vml` that won't parse is common (ActiveX decks) and costs one shape.
- **The converted copy goes**, as for a native deck (`deleteSupersededBySource`).
- **No LibreOffice needed**, so a `.pptx` joins the legacy decks in `deckMayBeReadNatively`: the
  renderer's gate is decided after main answers.

## Native decks: a legacy deck made of pictures is read, not converted (2026-10-26)

Every slide of the hymnal is an 800×600 JPEG with the lyrics drawn into it. For such a deck the
pipeline above is skipped entirely:

```
.pps/.ppt ──ppt-binary.ts (OLE2 + PowerPoint 97 records, ~1 ms)──► layers per slide ──► SQLite
                                                                         │
worship://deck/<id>/<n> ◄── native-deck.ts: the JPEG as is, or an SVG ◄─┘  (read from the source, per request)
```

- **What is read** (`readBinaryDeck`): per VISIBLE slide (hidden ones are left out, as the show and
  LibreOffice's PDF leave them out), the topmost opaque JPEG that covers the whole slide is its base,
  and everything above it must be a picture drawn as is (the hymn's white logo, a PNG) or something
  PowerPoint does not show: off the slide, `fHidden`, or a sound/movie with `AnimationInfoAtom.fHide`
  — the speaker icon, which LibreOffice draws and PowerPoint hides
  ([`libreoffice-draws-sound-icons-powerpoint-hides.md`](../../.claude/knowledge/libreoffice-draws-sound-icons-powerpoint-hides.md)).
  Pictures carry a whitelist of properties (crop and rotation 0, no recolor, line off, and fill off
  under a PNG), inherited flag by flag from the master shape they name
  ([`officeart-boolean-properties-inherit-flag-by-flag.md`](../../.claude/knowledge/officeart-boolean-properties-inherit-flag-by-flag.md));
  a master is found by its `slideId`, not a persist id
  ([`a-slides-masteridref-is-a-slideid-not-a-persist-id.md`](../../.claude/knowledge/a-slides-masteridref-is-a-slideid-not-a-persist-id.md)).
  **Anything else anywhere refuses the whole deck**, which then goes through LibreOffice exactly as
  before: never half a deck each way, never a slide drawn wrong in silence. Measured on the hymnal:
  1229 of 1231 decks read natively, in 0.3 ms each; the two refused are `394.pps` (slide 5 leaves a
  13-unit strip uncovered) in both folders.
- **What is stored**: a `slide_decks` row with `image_format = 'native'`, `render_width = 0`,
  `cache_dir = ''` (it owns no folder — every path that deletes or rebases a deck's folder checks the
  format first), `timings_source = 'binary'` and `converter_version = SLIDES_NATIVE_VERSION`; one
  `deck_slides` row per slide whose `layers` column is the JSON `SlideLayers` (each picture's offset
  and length inside the `Pictures` stream, and its rect in slide units). Identity is the content
  hash, like any deck.
- **What is served**: a slide that is one picture edge to edge in its own proportions is that JPEG,
  byte for byte (~4 of 5 hymnal slides); otherwise an SVG placing each picture where PowerPoint does,
  pictures as `data:` URIs (an SVG used as an image fetches nothing). The source must still be the
  file the layers were read from — same `(size, mtime)` — or the answer is 410. `/thumb` is the base
  picture alone: composing the SVG for every tile of a library grid cost ~800 KB of base64 each.
- **Where it runs**: `nativeDeck()` in `deck-service.ts`, before the cache and before the queue —
  in `prepareDeck`, in `runConversion` (a job queued before the deck could be read) and in
  `warmBatchPdfCache` (a native deck is never handed to `soffice`). `getDeck` answers a native deck,
  and answers nothing for a legacy deck not read yet, so the renderer never puts on screen urls of
  a converted copy the read is about to retire.
- **The converted copy goes** (owner's decision, 2026-10-26): reading a deck natively deletes the
  rasterized decks of the same content hash and their folders — except one pinned to the projector,
  which the startup sweep deletes on the next launch (`deleteSupersededBySource`).
- **No LibreOffice needed** for these decks, so the renderer's gate for a `.ppt`/`.pps` is decided
  after main answers (`sofficeBlocks(environment, ext, entry)`, `deckMayBeReadNatively`), never in
  front of the deck. See *Without LibreOffice* below.
- **The linked song** is found from the record that names it (`ExObjList` → `CString`,
  `readBinaryExternalPaths`), not by scanning the file: the scan was most of a second per hymn
  ([`linked-audio-hint-scan-was-hidden-behind-libreoffice.md`](../../.claude/knowledge/linked-audio-hint-scan-was-hidden-behind-libreoffice.md)).

## Slide transitions (2026-10-26)

Every deck now carries each slide's own way in (`DeckSlide.transition`, a `SlideTransition`): from
`SlideShowSlideInfoAtom` (`effectType`/`effectDirection`/`speed`) in a binary, from `p:transition`
in OOXML. Fade and «fade through black» and random bars are drawn as themselves; any other effect is
a crossfade of its own length; a cut is `null`. Speeds are PowerPoint's: slow 1 s, medium 0.75 s,
fast 0.5 s. Decided by the owner: they play **only when the deck moves forward** (back is a cut),
and entering the deck keeps the scene transition from Settings. A deck converted before this read
its transitions on its next cache hit (`readTransitionsInto`, `slide_decks.transitions_read`), with
no reconversion. On the projector it is `ProjectionOutput.enter` (see `04-renderer-state.md`).

## A PDF enters through the middle of the pipeline

A `.pdf` is just another deck (`ASSET_EXTENSIONS.ppt`, `kind = "ppt"`, `ProgramItemKind` `"ppt"`) —
not an `AssetKind` of its own. Throughout the renderer `kind === "ppt"` already means "this is a
deck", so adding the extension is enough to inherit the dialog filter, drag & drop, folder import,
the content-addressed cache, prewarm, "Prepare folder", thumbs and badges without a single new
branch.

What does change is that **the PDF already IS the intermediate format**: `runConversion` sends it
straight to the rasterizer and `warmBatchPdfCache` takes it out of the batch. Running it through
`soffice` isn't "slower", it's worse: LibreOffice imports it into **Draw** and redraws it glyph by
glyph (`convert … as a Draw document … using filter: draw_pdf_Export`; measured, 157 KB → 1.76 MB).

Two consequences the UI has to respect:

- **A PDF doesn't need LibreOffice.** `deckRequiresSoffice(ext)` (`shared/constants.ts`) is the
  single source for that question, and every LibreOffice block is decided **per deck**, never per
  environment — see *Without LibreOffice* below.
- **A PDF has no presentation metadata**: no transitions (⇒ `timings_source = "none"`, no
  auto-advance) and no media parts (⇒ no embedded soundtrack). The sibling *linked* `.mp3` is still
  resolved, as for any other deck.

Rasterizing scales to fit a `targetWidth` square, not just by width: every Impress/PowerPoint slide
is landscape and width always won, but a PDF page can be portrait. Diagnosis and measurements
—including why this does **not** force a bump of `SLIDES_CONVERTER_VERSION`— in
[`.claude/knowledge/a-pdf-source-breaks-two-assumptions-the-pipeline-made-about-its-own-output.md`](../../.claude/knowledge/a-pdf-source-breaks-two-assumptions-the-pipeline-made-about-its-own-output.md),
which also explains the case of non-embedded fonts and the new `PDF_PASSWORD` error.

## Without LibreOffice

LibreOffice isn't bundled, so a machine without it is a normal case, not an error: the app starts,
warns, and blocks **only** what truly needs it — converting a deck that isn't cached yet and that
the app can't read itself. A PDF, an already-converted deck (projecting it is serving images), a
`.pptx` drawn from its model, a legacy deck read natively and everything that isn't a deck keep
working the same. Which `.pptx` or legacy `.ppt`/`.pps` still needs it is only known once main has
read it, so for those every block below is decided by main's answer: the renderer tries, and
`sofficeBlocks(environment, ext, entry)` blocks one only after it `failed`.

**The question, on each side:**

- **Main** remembers the last answer from the scan (`locateSoffice`, cached).
  `cachedSofficeError()` returns it without searching again, and `prepareDeck` uses it so that
  **background** work (visible tiles, schedule, freshly imported files, «Prepare folder») on a
  non-PDF deck is rejected on the spot: no queue, no file hash, no progress bar on the tile — after
  the native read, which needs none of it. The
  **interactive** path (the operator opened the deck) always goes through `requireSoffice`, which
  scans again — that's how a LibreOffice installed while the app is open gets found. `runConversion`
  asks for it right before step 3 (the actual conversion): not before the content hit, which
  projects a duplicate without LibreOffice, and inside the `try`, so the failure is announced like
  any other.
- **Renderer**: `deck.store.environment` (`deck:environment`, with `force` for «Check again») and
  `sofficeBlocks(environment, ext)` is the only question. It never says anything about an
  already-converted deck, so every block also asks whether there are slides to show. It corrects
  itself: a conversion that succeeded with the environment at «missing», or that failed with the
  environment at «present», reads it again — main just scanned on that path.

**The blocks and the warnings:**

| Where | What it does |
|---|---|
| Startup (`announceMissingSoffice`) | toast with «Don't show again», once per process |
| PPT tab (`media-browser.tsx`) | short strip with «Download LibreOffice» and «Don't show again» |
| Center panel (`deck-slides.tsx`) | the notice with main's reason and the three ways out (`SofficeActions`), **only** if the deck has no slides; on a converted one, «Convert again» is replaced by the why |
| PREVIEW monitor | «LibreOffice isn't available» instead of «Getting ready to convert…», which stayed there forever |
| GO LIVE | changes nothing on the projector and warns with a toast — decided **after** the failure (`explainSofficeRefusal`), because only main knows whether the deck is cached, and a prior check rejected a converted deck on double-click before its `peek` came back |
| «Prepare folder» | prepares only the PDFs in the view |
| Settings → Slides → LibreOffice | status, version and path (or the reason), the three ways out, and the `slides.warnMissingSoffice` switch |

`slides.warnMissingSoffice` turns off the toast and the strip, which are the «just in case»
warnings. The deck notice and Settings can't be turned off: they are where something actually got
blocked.

## Why rasterizing runs in a hidden `BrowserWindow`

Rasterizing needs a real Canvas2D. The alternative (`@napi-rs/canvas` in a `utilityProcess`)
publishes its native binary as a **per-platform** `optionalDependency`: unlike `better-sqlite3`
(8 binaries in one tarball), `npm install` on macOS never downloads the Windows one, so
cross-compiling the Windows installer from a Mac — something this project does — would ship a
broken app. A hidden window is already its own OS process, so crash isolation is the same, without
that risk.

The **legacy** build of pdf.js is used (`pdfjs-dist/legacy/build/pdf.mjs`): the modern bundle uses
built-ins that Electron 36's Chromium didn't have yet and failed with
`n.toHex is not a function` (Electron 44's Chromium 152 does have `Uint8Array.prototype.toHex`;
the legacy build is still the one imported).

**That window is reused across decks** (a single one, with an idle shutdown at 60 s — which never
comes during a batch). Consequence for any change in `slides/rasterizer.ts`: everything registered
*per job* on its `webContents` must be unregistered when the job ends. A
`once("render-process-gone")` is not enough: `once` only removes itself if the event fires, so it
piled up one listener per converted deck — with its closure and that job's `pages`/`request`
hanging off it — until Node warned
`MaxListenersExceededWarning: 11 render-process-gone listeners added to [WebContents]` halfway
through preparing a folder. The job's `finish()` is the only correct place for that cleanup.

## Identity by content hash

`slide_decks` is identified by `(content_hash, render_width, image_format)`, **not** by
`media_asset_id`. Two library entries pointing to copies of the same file share one conversion, and
moving the file is a cache hit instead of a reconversion. There is an earlier fast path by
`(size, mtime)` that doesn't even hash.

The hash does read the whole file, but through `fs/promises` and 1 MB at a time: the reads go to
the thread pool and `hash.update` is bounded by the chunk, not by the deck's size. Synchronously, a
60 MB `.pps` froze the thread that serves the projector for the whole read.

### The flip side: the row has a single owner

`media_asset_id` does exist on the row, and `relinkDeck` **moves** it when another asset resolves to
the same content. In other words: the conversion is shared, but *ownership* is exclusive. Everything
that asks "is this asset converted?" by looking at `media_asset_id` —as `statusesByAsset` did, and
with it the "Prepare folder" count, the tile badges and `adoptProgram`'s eviction pins— is asking an
ownership question about a content cache, and gets it wrong as soon as there are two identical
files: one shows as converted and the other doesn't, forever.

**It was a real defect, not a theoretical subtlety:** `N3` in
the internal audit `2026-09-11-cadena-de-media`
§5.2, measured at 555 false pendings over 1235 assets with 0 real work. Fixed on 2026-09-13:
`statusesByAsset` now JOINs by the asset's `content_hash` and falls back to ownership only for an
asset not stamped yet (see `05-data-and-persistence.md`). Don't count rows per asset to find out
what's left to convert.

## Timing alignment — the detail that matters

**LibreOffice does NOT export hidden slides to the PDF** (verified against a real deck). That's why
timings are aligned against the **visible** slides (`!hidden`), not against the full OOXML list:
getting this wrong shifts every timing one position per hidden slide. If the counts still don't
match (an animation that LibreOffice splits across several pages), **all** timings are discarded
(`timings_source = 'none'`) — a silently misaligned auto-advance is worse than no auto-advance.

## OOXML parsing

Parts are read with `readZipEntries` (`src/main/slides/zip-reader.ts`), **never** by loading the
whole file. A `.pptx` is a zip and a zip is random-access: it locates the end-of-central-directory
(with zip64), parses the central directory and reads only the requested byte ranges — a few KB, no
matter how many MB of media surround them. `unzipSync` with `filter` does **not** work for this: it
takes a buffer, so it avoids the inflate but not the `readFileSync`.

Two non-obvious details, measured in
[`.claude/knowledge/a-pptx-is-random-access-and-inflatesync-needs-its-out-buffer.md`](../../.claude/knowledge/a-pptx-is-random-access-and-inflatesync-needs-its-out-buffer.md):
the reader is **synchronous on purpose** (KB-sized reads, so nothing in the caller chain — up to
`MediaRepo.ensureLinkedAudio` and `toDeckDTO` — had to become `async`), and `inflateSync` must be
given the `out` buffer with the size the central directory already provides: without it, growing
its own output buffer costs ~16 µs per entry and makes the "fast" version 3× slower than reading
the whole file.

- `ppt/presentation.xml` → `<p:sldIdLst>` gives the **real order**. `slide1.xml, slide2.xml…` is
  creation order and diverges as soon as someone reorders.
- The `<p:transition>` is almost never at the slide root in modern decks: it lives in
  `mc:AlternateContent/mc:Choice[@Requires="p14"]`, with a copy in `mc:Fallback`. All three forms
  are checked. Looking only at the bare one is the most common way to read zero timings without
  noticing.
- `@advTm` (auto-advance ms), `@advClick`, `p:sld/@show="0"` (hidden).
- Audio: `p:pic` with `a:audioFile` + the slide's `_rels`; `p:cMediaNode` gives loop/volume.
  OOXML has no "plays across the whole deck" boolean — it's a documented heuristic
  (`loop` or `repeatCount="indefinite"` ⇒ `scope: "deck"`).
- Video: `p:pic` with `a:videoFile` (or the `p14:media` in `p:extLst`), with the same resolution
  through `_rels`. Three differences from audio, and all three matter:
  1. **Geometry is mandatory.** The rect comes from `p:spPr/a:xfrm` (EMU) against `p:sldSz` and is
     stored as 0..1 fractions. A `p:pic` **without** its own `a:xfrm` inherits the layout
     placeholder's, which this parser doesn't resolve: it is dropped and noted in
     `skippedVideoParts`. A default would be a clip stuck in the wrong place mid-service, and the
     rasterized slide already shows the poster frame in its place.
  2. **`p:cMediaNode` is looked up by `spid`**, not in aggregate. A slide with narration *and* a
     clip has two nodes, and giving the video the narration's volume is a muted clip with no
     explanation. It falls back to the whole-slide aggregate only when no node declares a
     `p:tgtEl`.
  3. **A `TargetMode="External"` rel is not a part.** `parseRels` drops it: joining a
     `C:\clips\intro.mp4` to `ppt/slides/` produces a plausible part name that names nothing. It
     was harmless while the value was only logged.
- Binary `.ppt`/`.pps` (OLE2, not zip): they are **also** converted to `.pptx` with a second
  LibreOffice pass to recover structure and embedded audio (`timings_source = 'ooxml-converted'`).
  **Video doesn't survive** that round-trip, and PowerPoint 97-2003 almost never embedded it (it
  linked it by absolute path), so embedded video playback is `.pptx`/`.ppsx`-only.

### From OOXML to the slide: the index changes space

OOXML indices count **hidden** slides; `deck_slides.slide_index` counts PDF **pages**, which don't
include them. The video is stored already translated into page space (a map built with the same
`visibleSlides` list that aligns the timings), and if the counts don't match **all** of the deck's
videos are dropped instead of approximated — the same discipline as `mergeBinaryTimings`, for the
same reason cubed: a shifted timing advances a slide early, a shifted video plays a clip over the
wrong slide.

## A legacy binary's timings do NOT come from the converted `.pptx`

The round-trip to `.pptx` **loses the auto-advance** of every slide that has no visual transition
effect: LibreOffice's export filter only writes the `<p:transition>` element when there is an
effect, and `advTm` is an attribute of that element. Measured on the user's real hymnal: all 1226
files have auto-advance in the source and **222 lose it** in the conversion. LibreOffice's import is
fine — the same file exported to `.odp` keeps every `presentation:duration`; it's only its PPTX
exporter.

That's why the timings are read from the **source binary**, not from the converted one:

- `src/main/slides/ppt-binary.ts` reads `SlideShowSlideInfoAtom` from the OLE2's
  `PowerPoint Document` stream, in presentation order (`Current User` → `UserEditAtom` →
  persist directory → instance-0 `SlideListWithText` → `SlidePersistAtom`). It never reads the whole
  file: images live in the `Pictures` stream, so it's ~45 KB of a 1.4 MB file, read sector by
  sector on demand.
- `mergeBinaryTimings` (in `deck-service.ts`) **only fills gaps** and checks itself: it compares the
  two reads wherever both have a number and, on a single discrepancy, abandons the whole merge. A
  deck that advances on another slide's time mid-service is worse than one that doesn't advance.
- `src/main/slides/backfill-timings.ts` applies the same thing retroactively, to already-converted
  decks, **without reconverting anything** — the times are in the source, so it's a re-read and an
  `UPDATE`.

Full diagnosis and the format's traps (the `fFlags` bits aren't consecutive; `PP97_DUALSTORAGE`) in
[`.claude/knowledge/libreoffice-pptx-export-drops-advtm-without-a-transition-effect.md`](../../.claude/knowledge/libreoffice-pptx-export-drops-advtm-without-a-transition-effect.md).

## LibreOffice isolation

`-env:UserInstallation=file://<userData>/soffice-profile` is **mandatory**: a dedicated profile
means a dedicated lock and named pipe, so a copy of LibreOffice the user opened as a normal app
neither steals our command nor blocks us. The profile is warmed once per version at startup
(`slides.profileWarmedVersion`).

On Windows **`soffice.com` is preferred over `soffice.exe`**: the `.exe` detaches and returns
before the PDF exists; the `.com` blocks until it's done.

Arguments always go as an `argv` array, never as a shell string — and the filter name goes
**without quotes** (`pptx:Impress MS PowerPoint 2007 XML`), because literal quotes become part of
the filter name and LibreOffice rejects it.

Two more invocation rules, learned in the 2026-09-11 audit:

- **`stdout` goes to `ignore`, not `pipe`.** A pipe nobody reads fills up (~64 KB) and **blocks the
  child** until the timeout kills it — indistinguishable from "LibreOffice hung". `--convert-to`
  prints one line per converted file, so a large enough batch gets there on its own. Nobody reads
  stdout: the outputs are discovered by listing `--outdir`. `stderr` is read, bounded.
- **A batch invocation needs its own `AbortController`.** It doesn't belong to any `Job`, so no
  per-job signal stops it, and `sofficeChain` serializes everything against the shared profile:
  without that controller, an interactive `deck:ensure` waited behind the whole chunk (up to 30
  minutes of `convertTimeoutForBatch`). `tryPreemptForInteractive` aborts it.

### Killing it for real

`soffice` is launched `detached` (its own group, so `killTree` reaches `soffice.bin` behind
`soffice`), and that means it **outlives main**. A live `soffice` holds the shared profile's lock
and named pipe, and then every conversion on the next startup fails silently — exactly what the
dedicated profile exists to prevent. Two defenses, because one alone isn't enough:

- **On quit:** SIGTERM and SIGKILL in the **same synchronous call** (`killTree(child, immediate)`;
  `execFileSync` on Windows). Nothing asynchronous runs in `before-quit` — the fallback
  `setTimeout` that was there before never ran.
- **On startup:** `reapOrphanedSoffice()` kills whatever was left over from a crash (which skips
  `before-quit` entirely), filtering by **our own** `-env:UserInstallation`, so a user's copy of
  LibreOffice is never touched. There's no Windows equivalent without PowerShell/WMI: there the
  orphan is still cleaned up by `resetSofficeProfile` after the timeouts.

Full detail in
[`.claude/knowledge/nothing-asynchronous-survives-before-quit.md`](../../.claude/knowledge/nothing-asynchronous-survives-before-quit.md).

## Progress: per page only for interactive work

`deck-progress` is emitted **per rasterized page only for `interactive` jobs**
(`emitPageProgress`). For background work only the state transitions go out; the batch's aggregate
progress travels over `prewarm-progress`. Emitting the per-page progress in the background too
turned a 600-deck folder into ~18,000 IPC messages, each one cloning in the renderer a `Record`
that grows with every deck — see
[`.claude/knowledge/an-aggregate-progress-channel-only-helps-if-the-per-item-one-goes-quiet.md`](../../.claude/knowledge/an-aggregate-progress-channel-only-helps-if-the-per-item-one-goes-quiet.md).

## The overlay dance is over

Since a slide is now an `<img>`, the projection window **never hides**. BLACK and LOGO are normal
`selectOutput` results, and the `projection:setOverlayVisible` channel is gone. Since 2026-09-09
the deck's audio pauses under BLACK/LOGO (and auto-advance freezes), resuming where it was — see
[`.claude/knowledge/deck-soundtrack-negro-logo-pause-and-autoplay-freeze.md`](../../.claude/knowledge/deck-soundtrack-negro-logo-pause-and-autoplay-freeze.md).

## Serving

`worship://deck/<deckId>/<n>[/thumb]` resolves against `deck_slides` and is served with
`Cache-Control: public, max-age=31536000, immutable` — the `(deckId, slideIndex)` pair is immutable
by construction (different content ⇒ different hash ⇒ different deckId). Without that header
Chromium would re-read every image on every slide change, live. The audio
(`worship://deck-audio/<id>`) goes without that header because it's traversed with seeks, not
replaced.

Everything `worship://` serves goes through `serveFile()`, which implements **real `Range`
semantics** (206 + `Content-Range`, `Accept-Ranges: bytes`, 416, streaming with
`fs.createReadStream({start,end})`). It used to delegate to `net.fetch(file://…)` without
forwarding the headers, which left all video/audio **without seek** and broke playback with
`PIPELINE_ERROR_DECODE (-12909)` from misaligned data — see
[`.claude/knowledge/worship-protocol-range-and-video-lifecycle.md`](../../.claude/knowledge/worship-protocol-range-and-video-lifecycle.md).

## Verification without launching the app

```bash
npm run slides:smoke -- "path/to/file.pptx"
```

Covers soffice discovery, conversion to PDF, the legacy `.ppt` round-trip, slide order, timings,
hidden slides and audio extraction. Rasterizing isn't covered there because it needs Chromium's
canvas — that only runs inside the app.
