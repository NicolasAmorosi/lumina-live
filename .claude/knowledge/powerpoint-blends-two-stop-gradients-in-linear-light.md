## PowerPoint blends a two-stop gradient in linear light and one with more stops in sRGB

**Area:** renderer
**Trigger:** a gradient whose middle is darker (or lighter) than PowerPoint's; `blendStops` in
`slide-paint.tsx`.

- Measured with `gen-gradients.pptx` (shapes and slide backgrounds; with and without `tileRect`,
  `flip`, `rotWithShape`): red→green with **two stops** has (188,129,54) in the middle — the
  linear-light mix; red→white→blue and a four-stop gradient follow the plain sRGB mix exactly
  (G = 51, 102, 153, 204 … in steps of 20%). The stop count is the only thing that decides it.
- SVG gradients blend in sRGB (Chromium has no `color-interpolation: linearRGB` for gradients),
  so a two-stop gradient gets intermediate stops mixed in linear light; the rest are drawn as is.
- PowerPoint's PDF carries the two-stop kind in a gamma-1 ICC profile — see
  [pdfjs-ignores-icc-profiles-so-powerpoint-gradients-paint-too-dark.md](pdfjs-ignores-icc-profiles-so-powerpoint-gradients-paint-too-dark.md).

**Last updated:** 2026-10-26
