## An embedded deck video survives all the way to the PDF — but never survives a `.ppt`

**Area:** slides (`main/slides/pptx-metadata.ts`, `main/slides/deck-service.ts`) | projection
(`shared/types/projection.ts`, `renderer/src/components/shared/output-view.tsx`)
**Trigger:** Touching the extraction or placement of a video embedded in a slide
(`PresentationMeta.video`, `deck_videos`, `SlideVideo`), or being asked why a `.pps` hymnal deck
never shows one.

> **Status: built on 2026-09-20**, as a positioned overlay — `SlideVideo` on `ProjectionOutput`,
> its own `MediaTarget` and a row in the live media panel. What follows is the measurement that
> shaped it; the part that still constrains the system is the `.ppt` limit below. The geometry
> half has its own entry:
> [`an-overlay-on-a-slide-must-rebuild-the-object-contain-box-and-cqh-needs-container-type-size.md`](an-overlay-on-a-slide-must-rebuild-the-object-contain-box-and-cqh-needs-container-type-size.md).

Measured in the 2026-09-20 session against a purpose-built fixture — a real `.pptx` carrying an
H.264/AAC `ppt/media/media1.mp4`, written with the exact structure PowerPoint 2010+ emits
(`a:videoFile/@r:link` for the part, plus `p14:media/@r:embed` in a `p:extLst`, plus a
`p:blipFill` poster and a `p:cMediaNode vol="80000"` under `p:timing`). Recorded because the
roadmap's one-liner — *"se detecta y se loguea, pero no se extrae"* — badly understates how much
of the hard part is already done, and overstates the part that is genuinely impossible.

### What already works, unchanged

- **Detection.** `readPresentationMeta` finds the `p:pic`, resolves the relationship and files
  the part in `meta.skippedVideoParts`. `npm run slides:smoke` on the fixture prints
  `video embebido (fuera de alcance): 1`.
- **Extraction is the audio code.** `extractAudioParts` already pulls a media part out of the zip
  into the deck cache under a *generated* filename (never the part name — a `.pptx` can carry
  `../` in one). Video is the same function with a different extension set.
- **Geometry is exact, not a guess.** `p:spPr/a:xfrm` (`a:off`/`a:ext`, EMU) against `p:sldSz`.
  Fixture: `off(3048000,1714500) ext(6096000,3429000)` over `12192000×6858000` = exactly
  25 %–75 % on both axes.
- **The rasterized slide already shows the right picture.** LibreOffice's PDF export draws the
  video's poster frame in its rect — verified visually on the fixture's exported PNG. So the
  cached slide image is a correct still of the video, and playback is an overlay on top of it,
  not a hole to patch.
- **Codecs are a non-issue in the normal case.** The app already plays H.264/AAC `.mp4` (the
  whole `PIPELINE_ERROR_DECODE (-12909)` diagnosis in
  [`worship-protocol-range-and-video-lifecycle.md`](worship-protocol-range-and-video-lifecycle.md)
  came from exactly that), and a modern PowerPoint embed is exactly that. `.wmv` / DivX `.avi`
  still need the `playable: false` treatment `deck_audio` already has.

### The surprise: LibreOffice puts the video *inside* the PDF, with its rect

The exported PDF contains a real `/Type /EmbeddedFile` (`/Length 66182` — the whole mp4) plus:

```
<</Type/Annot/Subtype/Screen/Rect[240.009 135.014 719.971 404.986]/A<</Type/Action /S/Rendition …
```

On a 960×540 pt page that rect is, again, exactly 25 %–75 %. And **pdf.js exposes it**:
`page.getAnnotations()` returns `{ subtype: "Screen", rect: [240.009, 135.014, 719.971, 404.986] }`.

So geometry can be recovered from the PDF we already rasterize, for *any* source format, with no
second OOXML pass. The **bytes** cannot: `doc.getAttachments()` returns `null`, because the
EmbeddedFile hangs off the MediaClip rather than the catalog's `/Names/EmbeddedFiles`. Conclusion:
**bytes from the OOXML, geometry from either.**

### The hard limit: legacy `.ppt`/`.pps` lose it completely

Converting the fixture to `.ppt` and back through LibreOffice:

```
video-embebido.pptx  118.655 B  →  .ppt 509.952 B  →  .pptx 16.967 B
.pptx back:  no ppt/media/, no a:videoFile
.ppt itself: does not contain the mp4 bytes at all (no "ftyp")
.ppt → PDF:  no /EmbeddedFile, no /Screen annotation
```

Same shape as
[`libreoffice-pptx-export-drops-advtm-without-a-transition-effect.md`](libreoffice-pptx-export-drops-advtm-without-a-transition-effect.md):
a LibreOffice *exporter* dropping something its importer handled fine. **Be honest about what
this measures**, though: it exercises LibreOffice's `.ppt` *writer*, not its reader of a genuine
PowerPoint-authored `.ppt`. The practical conclusion holds anyway, for a different reason —
PowerPoint 97-2003 essentially never embedded video, it *linked* it by absolute path
(`ppaction://media`), and that path is long gone from any machine the file reaches today.

**So: the feature is for `.pptx`/`.ppsx`. Do not spend time trying to recover video from the
hymnal's `.pps` files.**

### Where the real cost is: the projection contract, not the pipeline

`ProjectionOutput` with `kind: "slide"` is *one image url*, and the only video the projector
knows how to sustain is `videoUnderlay`, which is **full-screen**. A slide video is a rect
inside the slide. That means a positioned overlay touches:

- the exhaustive `switch` in `selectOutput` (`stores/projection.store.ts`) — the compiler will
  walk you through it;
- `output-view.tsx`, where the slide is `<img className="size-full object-contain">`; positioning
  anything over it needs the image wrapped in a box carrying the deck's aspect ratio, since
  `object-contain` letterboxes and the overlay must follow the *image* box, not the container;
- `MediaTarget` (today only `{kind:"video"}` and `{kind:"audio",trackId}`) — without a third
  target, `mediaStatus`, the media panel and `MediaCommand` cannot address it;
- the NEGRO/LOGO rule, which is a product decision, not a technical one: a deck video could
  follow the full-screen video (pause and hold position) or the deck soundtrack (keep going).

A much cheaper first step existed and was rejected: if the rect covers ≳95 % of the slide, route
it through the existing `videoUnderlay` and inherit NEGRO, pause, volume, seek, the confidence
monitors and the freeze-frame for free. The user chose the positioned overlay instead, and the
real deck this was verified against puts its clip at 81.9 % — the cheap path would have missed it.

The two traps flagged here were both real and are both closed now:

- A video `p:pic` with **no `a:xfrm`** inherits its geometry from the layout placeholder. It is
  now **skipped** rather than defaulted (`picRect` returns `null` → `skippedVideoParts`).
- For a **linked** (external) video, `parseRels` did `path.posix.join(baseDir, target)` over an
  absolute Windows path and produced garbage. `parseRels` now drops any rel carrying
  `TargetMode="External"`, so such a video simply has no part to read.

**Last updated:** 2026-09-20
