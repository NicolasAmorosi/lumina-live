/* eslint-disable react-refresh/only-export-components -- paint helpers that return SVG elements, next to the one component they use; nothing here keeps state a fast refresh would preserve. */
import type { Effects, Fill, GradientStop, ImageRef, Line, SlideTextSettings } from "@shared/types/slide-model";
import { createContext, type ReactNode } from "react";

/**
 * Turning model fills, lines and effects into SVG paint. Everything here is
 * pure: `SlideView` decides where things go, this decides how they look. SVG
 * ids are made unique per slide (`useId`), because two slides on one page
 * (PREVIEW and LIVE) must not share a gradient.
 */

export type ResolvePart = (part: string) => string;

/** What the window drawing a slide decides for its text (`SlideView`'s
 *  `text`), read by the text and the charts under it. With none — the
 *  regression harness — the system's own face and language. */
export const SlideTextContext = createContext<SlideTextSettings>({ fallbackFont: null, locale: "" });

/** A run's family list with the chosen fallback face before the generic one:
 *  after the file's face and its metric twins, never instead of them. */
export function withFallback(fonts: string, fallback: string | null): string {
  return fallback ? fonts.replace(/sans-serif$/, `"${fallback}", sans-serif`) : fonts;
}

/** What a paint may need beyond the fill itself. */
export type PaintContext = {
  resolve: ResolvePart;
  /** The slide's background and size, for a `background` fill. */
  background: Fill | null;
  slide: { w: number; h: number };
  /** Where the painted box's origin sits on the slide (EMU). */
  at: { x: number; y: number };
};

/** EMU → a CSS length that scales with the slide: `100cqw` is its width. */
export function cqw(emu: number, slideWidth: number): string {
  return `${(emu * 100) / slideWidth}cqw`;
}

/** An SVG `fill`/`stroke` value for a model fill in a `w × h` box, plus the
 *  defs it needs. */
export function svgPaint(fill: Fill | null, id: string, ctx: PaintContext, box: { w: number; h: number }): { paint: string; defs: ReactNode } {
  if (!fill) return { paint: "none", defs: null };
  switch (fill.kind) {
    case "solid":
      return { paint: fill.color, defs: null };
    case "linear": {
      // OOXML's angle is the direction the colours run, clockwise from +x, and
      // the first and last stops land on the box's corners (like CSS). With
      // `scaled` the angle lives in the unit square stretched onto the box;
      // without, it is a true angle on the box itself.
      const a = (fill.angle * Math.PI) / 180;
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      const [w, h, units] = fill.scaled ? [1, 1, "objectBoundingBox"] : [box.w, box.h, "userSpaceOnUse"];
      const half = (w * Math.abs(cos) + h * Math.abs(sin)) / 2;
      return {
        paint: `url(#${id})`,
        defs: (
          <linearGradient
            id={id}
            gradientUnits={units}
            x1={w / 2 - cos * half}
            y1={h / 2 - sin * half}
            x2={w / 2 + cos * half}
            y2={h / 2 + sin * half}
          >
            {blendStops(fill.stops).map((s, i) => (
              <stop key={i} offset={s.pos} stopColor={s.color} />
            ))}
          </linearGradient>
        ),
      };
    }
    case "path": {
      // Stop 0 fills the focus (`fillToRect`'s centre here) and the last stop
      // reaches the corner of the box farthest from it — PowerPoint stretches
      // the "circle" with the box, so the maths is in bounding-box units.
      const cx = (fill.focus.l + (1 - fill.focus.r)) / 2;
      const cy = (fill.focus.t + (1 - fill.focus.b)) / 2;
      if (fill.shape === "circle") {
        const r = Math.max(...[[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => Math.hypot(x! - cx, y! - cy)));
        return {
          paint: `url(#${id})`,
          defs: (
            <radialGradient id={id} cx={cx} cy={cy} r={r} fx={cx} fy={cy}>
              {blendStops(fill.stops).map((s, i) => (
                <stop key={i} offset={s.pos} stopColor={s.color} />
              ))}
            </radialGradient>
          ),
        };
      }
      // "rect" (and, approximately, "shape"): concentric rectangles from the
      // focus out to the edges — four trapezoids, each a linear gradient
      // running from the focus to its own edge.
      // ponytail: "shape" should follow the outline; drawn as "rect".
      const fx = cx * box.w;
      const fy = cy * box.h;
      const sides: [string, number, number, number, number][] = [
        [`M${fx} ${fy}L0 0L${box.w} 0Z`, fx, fy, fx, 0],
        [`M${fx} ${fy}L${box.w} 0L${box.w} ${box.h}Z`, fx, fy, box.w, fy],
        [`M${fx} ${fy}L${box.w} ${box.h}L0 ${box.h}Z`, fx, fy, fx, box.h],
        [`M${fx} ${fy}L0 ${box.h}L0 0Z`, fx, fy, 0, fy],
      ];
      return {
        paint: `url(#${id})`,
        defs: (
          <pattern id={id} patternUnits="userSpaceOnUse" width={box.w} height={box.h}>
            {sides.map(([d, x1, y1, x2, y2], k) => (
              <g key={k}>
                <linearGradient id={`${id}-${k}`} gradientUnits="userSpaceOnUse" x1={x1} y1={y1} x2={x2} y2={y2}>
                  {blendStops(fill.stops).map((s, i) => (
                    <stop key={i} offset={s.pos} stopColor={s.color} />
                  ))}
                </linearGradient>
                <path d={d} fill={`url(#${id}-${k})`} />
              </g>
            ))}
          </pattern>
        ),
      };
    }
    case "image": {
      const tile = fill.mode === "tile" ? fill.tile : undefined;
      if (tile) {
        // Tiles at the picture's natural size times sx/sy, the first one
        // anchored at `align` and moved by tx/ty.
        const tw = tile.size.w * tile.sx;
        const th = tile.size.h * tile.sy;
        const ax = tile.align.endsWith("r") ? box.w - tw : tile.align === "ctr" || tile.align === "t" || tile.align === "b" ? (box.w - tw) / 2 : 0;
        const ay = tile.align.startsWith("b") ? box.h - th : tile.align === "ctr" || tile.align === "l" || tile.align === "r" ? (box.h - th) / 2 : 0;
        // A flipped tiling mirrors every other tile: the repeating unit is two
        // tiles wide (x) and/or tall (y), with the mirrored copies in it.
        const fx = tile.flip === "x" || tile.flip === "xy";
        const fy = tile.flip === "y" || tile.flip === "xy";
        const copies: [boolean, boolean][] = [[false, false], ...(fx ? [[true, false] as [boolean, boolean]] : []), ...(fy ? [[false, true] as [boolean, boolean]] : []), ...(fx && fy ? [[true, true] as [boolean, boolean]] : [])];
        return {
          paint: `url(#${id})`,
          defs: (
            <pattern id={id} patternUnits="userSpaceOnUse" width={tw * (fx ? 2 : 1)} height={th * (fy ? 2 : 1)} x={ax + tile.tx} y={ay + tile.ty}>
              {copies.map(([mx, my], k) => (
                <g key={k} transform={`translate(${mx ? 2 * tw : 0} ${my ? 2 * th : 0}) scale(${mx ? -1 : 1} ${my ? -1 : 1})`}>
                  <ImageInBox id={`${id}-i${k}`} image={fill.image} w={tw} h={th} resolve={ctx.resolve} />
                </g>
              ))}
            </pattern>
          ),
        };
      }
      return {
        paint: `url(#${id})`,
        defs: (
          <pattern id={id} patternUnits="userSpaceOnUse" width={box.w} height={box.h}>
            <ImageInBox id={`${id}-i`} image={fill.image} w={box.w} h={box.h} resolve={ctx.resolve} />
          </pattern>
        ),
      };
    }
    case "pattern":
      return {
        paint: `url(#${id})`,
        defs: (
          // Tiles line up with the slide's origin, not the shape's.
          <pattern id={id} patternUnits="userSpaceOnUse" width={8 * BIT} height={8 * BIT} x={-ctx.at.x} y={-ctx.at.y}>
            <rect width={8 * BIT} height={8 * BIT} fill={fill.bg} />
            <path d={patternPath(fill.preset)} fill={fill.fg} />
          </pattern>
        ),
      };
    case "background": {
      // The slide's background, drawn on a slide-sized tile placed so that the
      // slide's origin falls where it is: the shape is a window onto it.
      const inner = svgPaint(ctx.background, `${id}-b`, ctx, ctx.slide);
      return {
        paint: `url(#${id})`,
        defs: (
          <pattern id={id} patternUnits="userSpaceOnUse" x={-ctx.at.x} y={-ctx.at.y} width={ctx.slide.w} height={ctx.slide.h}>
            <defs>{inner.defs}</defs>
            <rect width={ctx.slide.w} height={ctx.slide.h} fill={inner.paint === "none" ? "white" : inner.paint} />
          </pattern>
        ),
      };
    }
  }
}

/**
 * PowerPoint blends a TWO-stop gradient in linear light and one with three or
 * more stops in sRGB (measured: `gen-gradients.pptx`, shapes and backgrounds
 * alike; its PDF carries the two-stop kind in a gamma-1 ICC profile). SVG
 * blends in sRGB, so a two-stop gradient gets stops in between, mixed in
 * linear light.
 */
export function blendStops(stops: GradientStop[]): GradientStop[] {
  const [a, b] = stops;
  if (stops.length !== 2 || !a || !b || a.color === b.color) return stops;
  const ca = channels(a.color);
  const cb = channels(b.color);
  const out: GradientStop[] = [a];
  const steps = 12;
  for (let k = 1; k < steps; k++) {
    const t = k / steps;
    const mix = [0, 1, 2].map((c) => Math.round(255 * fromLinear(toLinear(ca[c]!) * (1 - t) + toLinear(cb[c]!) * t)));
    out.push({ pos: a.pos + (b.pos - a.pos) * t, color: `rgba(${mix.join(",")},${ca[3]! * (1 - t) + cb[3]! * t})` });
  }
  out.push(b);
  return out;
}

/** `rgb(…)` / `rgba(…)` → 0..1 channels and alpha. */
function channels(css: string): number[] {
  const m = (css.match(/[\d.]+/g) ?? []).map(Number);
  return [(m[0] ?? 0) / 255, (m[1] ?? 0) / 255, (m[2] ?? 0) / 255, m[3] ?? 1];
}
const toLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const fromLinear = (c: number): number => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

/**
 * The 54 preset patterns: 8×8 bitmaps, most significant bit on the left, set
 * bits in the foreground colour. Read off PowerPoint's own rendering (its PDF
 * draws each as an 8 pt tile, one bit per point, aligned to the slide's origin).
 */
const PATTERN_BITS: Record<string, number[]> = {
pct5: [0x80, 0x00, 0x00, 0x00, 0x08, 0x00, 0x00, 0x00],
  pct10: [0x80, 0x00, 0x08, 0x00, 0x80, 0x00, 0x08, 0x00],
  pct20: [0x88, 0x00, 0x22, 0x00, 0x88, 0x00, 0x22, 0x00],
  pct25: [0x88, 0x22, 0x88, 0x22, 0x88, 0x22, 0x88, 0x22],
  pct30: [0xaa, 0x44, 0xaa, 0x11, 0xaa, 0x44, 0xaa, 0x11],
  pct40: [0xaa, 0x55, 0xaa, 0x51, 0xaa, 0x55, 0xaa, 0x15],
  pct50: [0xaa, 0x55, 0xaa, 0x55, 0xaa, 0x55, 0xaa, 0x55],
  pct60: [0xee, 0x55, 0xbb, 0x55, 0xee, 0x55, 0xbb, 0x55],
  pct70: [0x77, 0xdd, 0x77, 0xdd, 0x77, 0xdd, 0x77, 0xdd],
  pct75: [0x77, 0xff, 0xdd, 0xff, 0x77, 0xff, 0xdd, 0xff],
  pct80: [0xef, 0xff, 0xfe, 0xff, 0xef, 0xff, 0xfe, 0xff],
  pct90: [0xff, 0xff, 0xff, 0xf7, 0xff, 0xff, 0xff, 0x7f],
  horz: [0xff, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
  vert: [0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80],
  ltHorz: [0xff, 0x00, 0x00, 0x00, 0xff, 0x00, 0x00, 0x00],
  ltVert: [0x88, 0x88, 0x88, 0x88, 0x88, 0x88, 0x88, 0x88],
  dkHorz: [0xff, 0xff, 0x00, 0x00, 0xff, 0xff, 0x00, 0x00],
  dkVert: [0xcc, 0xcc, 0xcc, 0xcc, 0xcc, 0xcc, 0xcc, 0xcc],
  narHorz: [0xff, 0x00, 0xff, 0x00, 0xff, 0x00, 0xff, 0x00],
  narVert: [0x55, 0x55, 0x55, 0x55, 0x55, 0x55, 0x55, 0x55],
  dashHorz: [0xf0, 0x00, 0x00, 0x00, 0x0f, 0x00, 0x00, 0x00],
  dashVert: [0x80, 0x80, 0x80, 0x80, 0x08, 0x08, 0x08, 0x08],
  cross: [0xff, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80],
  dnDiag: [0x80, 0x40, 0x20, 0x10, 0x08, 0x04, 0x02, 0x01],
  upDiag: [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80],
  ltDnDiag: [0x88, 0x44, 0x22, 0x11, 0x88, 0x44, 0x22, 0x11],
  ltUpDiag: [0x11, 0x22, 0x44, 0x88, 0x11, 0x22, 0x44, 0x88],
  dkDnDiag: [0xcc, 0x66, 0x33, 0x99, 0xcc, 0x66, 0x33, 0x99],
  dkUpDiag: [0x33, 0x66, 0xcc, 0x99, 0x33, 0x66, 0xcc, 0x99],
  wdDnDiag: [0xc1, 0xe0, 0x70, 0x38, 0x1c, 0x0e, 0x07, 0x83],
  wdUpDiag: [0x83, 0x07, 0x0e, 0x1c, 0x38, 0x70, 0xe0, 0xc1],
  dashDnDiag: [0x00, 0x00, 0x88, 0x44, 0x22, 0x11, 0x00, 0x00],
  dashUpDiag: [0x00, 0x00, 0x11, 0x22, 0x44, 0x88, 0x00, 0x00],
  diagCross: [0x81, 0x42, 0x24, 0x18, 0x18, 0x24, 0x42, 0x81],
  smCheck: [0x99, 0x66, 0x66, 0x99, 0x99, 0x66, 0x66, 0x99],
  lgCheck: [0xf0, 0xf0, 0xf0, 0xf0, 0x0f, 0x0f, 0x0f, 0x0f],
  smGrid: [0xff, 0x88, 0x88, 0x88, 0xff, 0x88, 0x88, 0x88],
  lgGrid: [0xff, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80],
  dotGrid: [0xaa, 0x00, 0x80, 0x00, 0x80, 0x00, 0x80, 0x00],
  smConfetti: [0x80, 0x08, 0x40, 0x02, 0x10, 0x01, 0x20, 0x04],
  lgConfetti: [0xb1, 0x30, 0x03, 0x1b, 0xd8, 0xc0, 0x0c, 0x8d],
  horzBrick: [0xff, 0x80, 0x80, 0x80, 0xff, 0x08, 0x08, 0x08],
  diagBrick: [0x01, 0x02, 0x04, 0x08, 0x18, 0x24, 0x42, 0x81],
  solidDmnd: [0x10, 0x38, 0x7c, 0xfe, 0x7c, 0x38, 0x10, 0x00],
  openDmnd: [0x82, 0x44, 0x28, 0x10, 0x28, 0x44, 0x82, 0x01],
  dotDmnd: [0x80, 0x00, 0x22, 0x00, 0x08, 0x00, 0x22, 0x00],
  plaid: [0xaa, 0x55, 0xaa, 0x55, 0xf0, 0xf0, 0xf0, 0xf0],
  sphere: [0x77, 0x89, 0x8f, 0x8f, 0x77, 0x98, 0xf8, 0xf8],
  weave: [0x88, 0x54, 0x22, 0x45, 0x88, 0x14, 0x22, 0x51],
  divot: [0x00, 0x10, 0x08, 0x10, 0x00, 0x80, 0x01, 0x80],
  shingle: [0x03, 0x84, 0x48, 0x30, 0x0c, 0x02, 0x01, 0x01],
  wave: [0x00, 0x18, 0x25, 0xc0, 0x00, 0x18, 0x25, 0xc0],
  trellis: [0xff, 0x66, 0xff, 0x99, 0xff, 0x66, 0xff, 0x99],
  zigZag: [0x81, 0x42, 0x24, 0x18, 0x81, 0x42, 0x24, 0x18],
};

const BIT = 12700;
const patternPaths = new Map<string, string>();

/** The set bits of a preset as one path of 1-pt squares, merged per row. */
function patternPath(preset: string): string {
  const cached = patternPaths.get(preset);
  if (cached !== undefined) return cached;
  const rows = PATTERN_BITS[preset] ?? PATTERN_BITS["pct20"]!;
  let d = "";
  rows.forEach((row, y) => {
    for (let x = 0; x < 8; ) {
      if (!(row & (0x80 >> x))) {
        x++;
        continue;
      }
      let end = x;
      while (end < 8 && row & (0x80 >> end)) end++;
      d += `M${x * BIT} ${y * BIT}h${(end - x) * BIT}v${BIT}h${-(end - x) * BIT}Z`;
      x = end;
    }
  });
  patternPaths.set(preset, d);
  return d;
}

/** A picture laid into a `w × h` box: cropped (`crop` grows the image past
 *  the box) and inset (`fill`), stretched like PowerPoint stretches it, with
 *  its colour effects as an SVG filter. */
export function ImageInBox({ id, image, w, h, resolve }: { id: string; image: ImageRef; w: number; h: number; resolve: ResolvePart }): ReactNode {
  const f = image.fill ?? { l: 0, t: 0, r: 0, b: 0 };
  const c = image.crop ?? { l: 0, t: 0, r: 0, b: 0 };
  const boxW = w * (1 - f.l - f.r);
  const boxH = h * (1 - f.t - f.b);
  const fullW = boxW / Math.max(1e-6, 1 - c.l - c.r);
  const fullH = boxH / Math.max(1e-6, 1 - c.t - c.b);
  const filter = imageFilter(image, `${id}-fx`);
  return (
    <>
      {filter}
      <image
        href={resolve(image.part)}
        x={w * f.l - c.l * fullW}
        y={h * f.t - c.t * fullH}
        width={fullW}
        height={fullH}
        preserveAspectRatio="none"
        opacity={image.alpha < 1 ? image.alpha : undefined}
        filter={filter ? `url(#${id}-fx)` : undefined}
      />
    </>
  );
}

const LUMA = "0.2126 0.7152 0.0722 0 0";

function imageFilter(image: ImageRef, id: string): ReactNode {
  if (image.effects.length === 0) return null;
  const steps: ReactNode[] = [];
  image.effects.forEach((e, i) => {
    switch (e.kind) {
      case "grayscale":
        steps.push(<feColorMatrix key={i} type="matrix" values={`${LUMA} ${LUMA} ${LUMA} 0 0 0 1 0`} />);
        break;
      case "duotone": {
        // Luminance, then black → the dark colour and white → the light one.
        const d = channels(e.dark);
        const l = channels(e.light);
        steps.push(<feColorMatrix key={`${i}m`} type="matrix" values={`${LUMA} ${LUMA} ${LUMA} 0 0 0 1 0`} />);
        steps.push(
          <feComponentTransfer key={`${i}t`}>
            <feFuncR type="table" tableValues={`${d[0]} ${l[0]}`} />
            <feFuncG type="table" tableValues={`${d[1]} ${l[1]}`} />
            <feFuncB type="table" tableValues={`${d[2]} ${l[2]}`} />
          </feComponentTransfer>,
        );
        break;
      }
      case "lum": {
        const slope = e.contrast >= 0 ? 1 / Math.max(1e-3, 1 - e.contrast) : 1 + e.contrast;
        const intercept = e.bright + 0.5 * (1 - slope);
        steps.push(
          <feComponentTransfer key={i}>
            <feFuncR type="linear" slope={slope} intercept={intercept} />
            <feFuncG type="linear" slope={slope} intercept={intercept} />
            <feFuncB type="linear" slope={slope} intercept={intercept} />
          </feComponentTransfer>,
        );
        break;
      }
      case "biLevel": {
        const t = `${"0 ".repeat(Math.round(e.threshold * 10))}${"1 ".repeat(10 - Math.round(e.threshold * 10))}`.trim();
        steps.push(<feColorMatrix key={`${i}m`} type="matrix" values={`${LUMA} ${LUMA} ${LUMA} 0 0 0 1 0`} />);
        steps.push(
          <feComponentTransfer key={`${i}t`}>
            <feFuncR type="discrete" tableValues={t} />
            <feFuncG type="discrete" tableValues={t} />
            <feFuncB type="discrete" tableValues={t} />
          </feComponentTransfer>,
        );
        break;
      }
      case "clrChange": {
        // The common case: one colour (usually white) made transparent. Alpha
        // drops where every channel is within ~4% of it.
        const [r = 1, g = 1, b = 1] = channels(e.from);
        const near = (v: number): string => {
          const cells = Array.from({ length: 26 }, (_, k) => (Math.abs(k / 25 - v) <= 0.04 ? 1 : 0));
          return cells.join(" ");
        };
        steps.push(
          <feColorMatrix key={`${i}a`} type="matrix" values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 1 0" result={`k${i}`} />,
          <feComponentTransfer key={`${i}r`} in={`k${i}`} result={`m${i}`}>
            <feFuncR type="discrete" tableValues={near(r)} />
            <feFuncG type="discrete" tableValues={near(g)} />
            <feFuncB type="discrete" tableValues={near(b)} />
          </feComponentTransfer>,
          // match = r·g·b of the three masks → alpha := 1 - match
          <feColorMatrix key={`${i}x`} in={`m${i}`} type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 -0.34 -0.33 -0.33 0 1" result={`n${i}`} />,
          <feComponentTransfer key={`${i}y`} in={`n${i}`} result={`q${i}`}>
            <feFuncA type="discrete" tableValues="0 1 1 1" />
          </feComponentTransfer>,
          <feComposite key={`${i}c`} in="SourceGraphic" in2={`q${i}`} operator="in" />,
        );
        break;
      }
    }
  });
  return (
    <filter id={id} colorInterpolationFilters="sRGB" x="0" y="0" width="1" height="1">
      {steps}
    </filter>
  );
}

/** Stroke attributes of a line, in the SVG's EMU units. */
export function strokeProps(line: Line | null, paint: string): Record<string, string | number | undefined> {
  if (!line || paint === "none") return { stroke: "none" };
  const width = Math.max(line.width, 6350);
  return {
    stroke: paint,
    strokeWidth: width,
    strokeDasharray: line.dash ? line.dash.map((d) => d * width).join(" ") : undefined,
    strokeLinecap: line.cap === "round" ? "round" : line.cap === "square" ? "square" : "butt",
    strokeLinejoin: line.join,
    strokeMiterlimit: 8,
  };
}

/** CSS `filter` for the effects SVG can't express on a shape: shadow, glow. */
export function effectFilter(effects: Effects, slideWidth: number): string | undefined {
  const parts: string[] = [];
  const s = effects.shadow;
  if (s && !s.inner) {
    const a = (s.dir * Math.PI) / 180;
    parts.push(`drop-shadow(${cqw(Math.cos(a) * s.dist, slideWidth)} ${cqw(Math.sin(a) * s.dist, slideWidth)} ${cqw(s.blur / 2, slideWidth)} ${s.color})`);
  }
  if (effects.glow) parts.push(`drop-shadow(0 0 ${cqw(effects.glow.radius / 2, slideWidth)} ${effects.glow.color})`);
  return parts.length ? parts.join(" ") : undefined;
}
