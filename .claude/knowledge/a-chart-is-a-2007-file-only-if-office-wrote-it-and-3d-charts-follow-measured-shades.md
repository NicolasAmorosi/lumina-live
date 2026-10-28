## A chart is a «2007 file» only if Office wrote it, and 3D charts follow measured shades and a half-degree field of view

**Area:** renderer
**Trigger:** a chart whose defaults look wrong (labels that shouldn't show, a pie tilted 30°), a 3D, bubble
or radar chart off from PowerPoint; `chart.ts`, `slide-chart.tsx`.

- **Which defaults apply.** PowerPoint 2007 fills absent chart elements with Office's own defaults; later
  versions use the schema's. A file counts as 2007 only with `AppVersion` 12 **and** an `Application`
  starting with «Microsoft» (LibreOffice's rule): a template that says 12 with no `Application` is read
  as a later file — getting that alone took several of its charts from ~17 to ~3.7 coarse.
- **Schema defaults in later files**: a bare `<c:dLbls/>` shows series, category, value, percent and
  legend key; a bare `<c:view3D>` is rotation 0/0 with right-angled axes. Only 2007 files fall back to
  15°/20° (a pie tilts 30°). An unnamed series is «Series1», no space.
- **3D, measured on the corpus**: front face at full colour, top 0.76, right side 0.62, with or without
  right-angled axes; a pie3D rim runs 0.85 → 0.55 → 0.38 left to right. `perspective` is the field of view
  in half-degrees. A 3D value axis gets no 5% headroom (data to 700 → axis to 700). Depth is
  `depthPercent` of one category band, deepening more slowly past 100%. The box height in perspective is
  an empirical fit on four charts, not a known rule.
- **Bubbles**: the largest diameter is ¼ of the plot's smaller side *including* tick labels hanging
  outside it; sizes go by area unless `sizeRepresents="w"`.
- **Radar** (fitted on four decks): labels wrap at 0.234 of the chart width, at most 5 scale intervals
  whatever the font size, ~43 px above and below the web.
- **Numbers follow the OS region, not the UI language**: PowerPoint wrote «0,5» and joined label parts
  with «; » on a Mac set to English with region Italy. `Intl.NumberFormat()` in the renderer resolves to
  `app.getLocale()` (the UI language); `app.getSystemLocale()` would match. Not changed yet.

**Last updated:** 2026-10-28
