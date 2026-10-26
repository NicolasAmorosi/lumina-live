## PowerPoint for Mac's PDF is not a reference for metafiles
**Area:** slides
**Trigger:** measuring how an EMF/WMF picture is drawn against a PDF that PowerPoint for Mac exported; a metafile that looks sharper in our render than in the reference

- The fidelity reference for slides is PowerPoint's own PDF export. For metafiles, PowerPoint for
  Mac's export is NOT faithful: a metafile that carries a picture, or a low-resolution one, comes
  out as a low-resolution raster (pixelated logos and photos, white boxes behind masked images,
  blurry icons), and text marked with the default charset is decoded as Mac Roman (Chinese bytes
  come out as "¬Ω®Œ…").
- `metafileToSvg` keeps the Windows behaviour on purpose (vector output, Windows-1252 for the
  default charset), so on those slides our render is sharper than the reference by design, and a
  pixel score against it is pessimistic. Judge such slides by eye at zoom, not by the score.
- Measured 2026-10-26 on the 112 metafile slides of the fidelity corpus.

**Last updated:** 2026-10-26
