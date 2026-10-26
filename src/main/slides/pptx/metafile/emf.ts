import {
  BS_HATCHED,
  BS_NULL,
  BS_SOLID,
  Canvas,
  ETO_CLIPPED,
  ETO_OPAQUE,
  IDENTITY,
  PS_NULL,
  PS_SOLID,
  colorRef,
  compose,
  decodeAnsi,
  patternBrush,
  stockObject,
  type Brush,
  type Font,
  type GdiObject,
  type Matrix,
  type Pen,
} from "./canvas";
import { dibSize, readDib, type DibOptions } from "./dib";
import { EmfPlus } from "./emf-plus";

/**
 * An Enhanced Metafile ([MS-EMF]) played onto a `Canvas`.
 *
 * The SVG shows the header's `rclFrame` — the picture's extent in 0.01 mm, which is what a host
 * stretches over the picture's frame — converted to the reference device's pixels, the space every
 * record ends up in.
 *
 * EMF+ ([MS-EMFPLUS], records inside EMR_COMMENT) is played only for pictures (`emf-plus.ts`).
 * Office writes it "dual": the GDI records after each EMF+ record draw the same thing on their own,
 * and every EMF+ file in the corpus is dual (22 of 22). A file that is EMF+ only would have nothing
 * for this player to draw, so it is refused (`null`) rather than shown empty.
 */

const EMR_HEADER = 1;
const EMR_EOF = 14;
const EMF_SIGNATURE = 0x464d4520; // " EMF"
const EMFPLUS_SIGNATURE = 0x2b464d45; // "EMF+"
const ETO_GLYPH_INDEX = 0x10;
const ETO_PDY = 0x2000;
const AC_SRC_ALPHA = 1;

/** Records that draw (rather than set state): what an EMF+ picture's GDI fallback is made of. */
const DRAWING = new Set([
  2, 3, 4, 5, 6, 7, 8, 15, 41, 42, 43, 44, 45, 46, 47, 53, 54, 55, 56, 62, 63, 64, 71, 72, 73, 74, 76, 77, 78, 79, 80, 81,
  83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 96, 97, 108, 114, 116, 118,
]);

export function isEmf(bytes: Uint8Array): boolean {
  if (bytes.length < 88) return false;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return v.getUint32(0, true) === EMR_HEADER && v.getUint32(40, true) === EMF_SIGNATURE;
}

export function emfToSvg(bytes: Uint8Array): string | null {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // The header record also carries the description string (and maybe a pixel format): where
  // either starts is where the header's own fields end, and that says which extensions it has.
  let headerSize = v.getUint32(4, true);
  if (v.getUint32(60, true) > 0 && v.getUint32(64, true) >= 88) headerSize = Math.min(headerSize, v.getUint32(64, true));
  if (headerSize >= 100 && v.getUint32(88, true) > 0 && v.getUint32(92, true) >= 88) {
    headerSize = Math.min(headerSize, v.getUint32(92, true));
  }
  const bounds = [8, 12, 16, 20].map((o) => v.getInt32(o, true)) as [number, number, number, number];
  const frame = [24, 28, 32, 36].map((o) => v.getInt32(o, true)) as [number, number, number, number];
  const device = { x: v.getInt32(72, true), y: v.getInt32(76, true) };
  // szlMicrometers (header extension 2) when present: szlMillimeters is rounded to whole mm.
  let um = { x: v.getInt32(80, true) * 1000, y: v.getInt32(84, true) * 1000 };
  if (headerSize >= 108 && v.getInt32(100, true) > 0 && v.getInt32(104, true) > 0) {
    um = { x: v.getInt32(100, true), y: v.getInt32(104, true) };
  }
  if (device.x <= 0 || device.y <= 0 || um.x <= 0 || um.y <= 0) return null;
  const pxPerMm = { x: (device.x * 1000) / um.x, y: (device.y * 1000) / um.y };
  let view = {
    x: (frame[0] * pxPerMm.x) / 100,
    y: (frame[1] * pxPerMm.y) / 100,
    w: ((frame[2] - frame[0]) * pxPerMm.x) / 100,
    h: ((frame[3] - frame[1]) * pxPerMm.y) / 100,
  };
  let mm = { w: (frame[2] - frame[0]) / 100, h: (frame[3] - frame[1]) / 100 };
  if (!(view.w > 0 && view.h > 0)) {
    // No usable frame: the bounds (device pixels, inclusive) are the picture.
    view = { x: bounds[0], y: bounds[1], w: bounds[2] - bounds[0] + 1, h: bounds[3] - bounds[1] + 1 };
    mm = { w: view.w / pxPerMm.x, h: view.h / pxPerMm.y };
    if (!(view.w > 0 && view.h > 0)) return null;
  }
  const canvas = new Canvas(view, { w: (mm.w * 96) / 25.4, h: (mm.h * 96) / 25.4 }, pxPerMm);
  const dc = (): Canvas["dc"] => canvas.dc;
  const objects = new Map<number, GdiObject>();
  const plus = new EmfPlus();
  /** Set after an EMF+ picture this player drew: the GDI records up to the next EMF+ comment are
   *  its fallback. */
  let fallback = false;

  for (let at = 0; at + 8 <= bytes.length; ) {
    const type = v.getUint32(at, true);
    const size = v.getUint32(at + 4, true);
    if (size < 8 || at + size > bytes.length) break;
    const i32 = (o: number): number => v.getInt32(at + o, true);
    const u32 = (o: number): number => v.getUint32(at + o, true);
    const f32 = (o: number): number => v.getFloat32(at + o, true);
    /** `count` points of 32-bit (`wide`) or 16-bit coordinates from `o`, clamped to the record. */
    const points = (o: number, count: number, wide: boolean): Int32Array => {
      const step = wide ? 4 : 2;
      const n = Math.max(0, Math.min(count, Math.floor((size - o) / (2 * step))));
      const out = new Int32Array(n * 2);
      for (let i = 0; i < n * 2; i += 1) out[i] = wide ? v.getInt32(at + o + i * 4, true) : v.getInt16(at + o + i * 2, true);
      return out;
    };
    const polyPolys = (wide: boolean): Int32Array[] => {
      const n = u32(24);
      const polys: Int32Array[] = [];
      let p = 32 + 4 * n;
      for (let i = 0; i < n && 32 + 4 * i + 4 <= size; i += 1) {
        const count = u32(32 + 4 * i);
        polys.push(points(p, count, wide));
        p += count * (wide ? 8 : 4);
      }
      return polys;
    };
    const rect = (o: number): [number, number, number, number] => [i32(o), i32(o + 4), i32(o + 8), i32(o + 12)];
    const point = (o: number): { x: number; y: number } => ({ x: i32(o), y: i32(o + 4) });
    /** The DIB a record carries, with its height and row order; `null` when it carries none or
     *  one that cannot be read — which costs that bitmap, not the picture. */
    const dib = (offBmi: number, cbBmi: number, offBits: number, cbBits: number, usage: number, more: DibOptions = {}) => {
      if (cbBmi === 0 || offBmi === 0) return null;
      const info = bytes.subarray(at + offBmi, at + offBmi + cbBmi);
      const bits = bytes.subarray(at + offBits, at + offBits + cbBits);
      try {
        return { source: readDib(info, bits, { usage, palette: dc().palette, ...more }), ...dibSize(info) };
      } catch {
        return null;
      }
    };

    if (fallback && DRAWING.has(type)) {
      at += size;
      continue;
    }
    switch (type) {
      case 2: // POLYBEZIER
      case 85:
        canvas.polyBezier(points(28, u32(24), type === 2));
        break;
      case 3: // POLYGON
      case 86:
        canvas.polygon(points(28, u32(24), type === 3));
        break;
      case 4: // POLYLINE
      case 87:
        canvas.polyline(points(28, u32(24), type === 4));
        break;
      case 5: // POLYBEZIERTO
      case 88:
        canvas.polyBezierTo(points(28, u32(24), type === 5));
        break;
      case 6: // POLYLINETO
      case 89:
        canvas.polylineTo(points(28, u32(24), type === 6));
        break;
      case 7: // POLYPOLYLINE
      case 90:
        for (const poly of polyPolys(type === 7)) canvas.polyline(poly);
        break;
      case 8: // POLYPOLYGON
      case 91:
        canvas.polyPolygon(polyPolys(type === 8));
        break;
      case 56: // POLYDRAW
      case 92: {
        const count = u32(24);
        const wide = type === 56;
        const pts = points(28, count, wide);
        canvas.polyDraw(pts, bytes.subarray(at + 28 + count * (wide ? 8 : 4), at + 28 + count * (wide ? 9 : 5)));
        break;
      }
      case 9: // SETWINDOWEXTEX
        dc().winExt = { x: i32(8), y: i32(12) };
        break;
      case 10: // SETWINDOWORGEX
        dc().winOrg = { x: i32(8), y: i32(12) };
        break;
      case 11: // SETVIEWPORTEXTEX
        dc().vpExt = { x: i32(8), y: i32(12) };
        break;
      case 12: // SETVIEWPORTORGEX
        dc().vpOrg = { x: i32(8), y: i32(12) };
        break;
      case 31: // SCALEVIEWPORTEXTEX
      case 32: {
        const key = type === 31 ? "vpExt" : "winExt";
        const ext = dc()[key];
        if (i32(12) !== 0 && i32(20) !== 0) dc()[key] = { x: (ext.x * i32(8)) / i32(12), y: (ext.y * i32(16)) / i32(20) };
        break;
      }
      case 15: // SETPIXELV
        canvas.setPixel(i32(8), i32(12), colorRef(u32(16)));
        break;
      case 17: // SETMAPMODE
        dc().mapMode = u32(8);
        break;
      case 18: // SETBKMODE
        dc().bkMode = u32(8);
        break;
      case 19: // SETPOLYFILLMODE
        dc().polyFill = u32(8);
        break;
      case 20: // SETROP2
        dc().rop2 = u32(8);
        break;
      case 22: // SETTEXTALIGN
        dc().textAlign = u32(8);
        break;
      case 24: // SETTEXTCOLOR
        dc().textColor = colorRef(u32(8));
        break;
      case 25: // SETBKCOLOR
        dc().bkColor = colorRef(u32(8));
        break;
      case 27: // MOVETOEX
        canvas.moveTo(i32(8), i32(12));
        break;
      case 28: // SETMETARGN
        canvas.setMetaRegion();
        break;
      case 29: // EXCLUDECLIPRECT
      case 30: {
        const [l, t, r, b] = rect(8);
        canvas.clipRect(l, t, r, b, type === 29);
        break;
      }
      case 33: // SAVEDC
        canvas.save();
        break;
      case 34: // RESTOREDC
        canvas.restore(i32(8));
        break;
      case 35: // SETWORLDTRANSFORM
        dc().world = xform(f32, 8);
        break;
      case 36: {
        // MODIFYWORLDTRANSFORM. XFORM composes row vectors, so "left multiply" applies the new
        // transform before the current one.
        const x = xform(f32, 8);
        const mode = u32(32);
        const world = dc().world;
        dc().world =
          mode === 1 ? IDENTITY : mode === 2 ? compose(world, x) : mode === 3 ? compose(x, world) : mode === 4 ? x : world;
        break;
      }
      case 37: {
        // SELECTOBJECT: the high bit marks a stock object.
        const index = u32(8);
        canvas.select(index & 0x80000000 ? stockObject(index & 0x7fffffff) : objects.get(index));
        break;
      }
      case 38: {
        // CREATEPEN: LOGPEN. Width 0 is one device pixel; a dashed pen wider than 1 draws solid.
        const style = u32(12);
        const width = Math.abs(i32(16));
        const pen: Pen = {
          style: width > 1 && style >= 1 && style <= 4 ? PS_SOLID : style,
          width,
          color: colorRef(u32(24)),
          cosmetic: width === 0,
          cap: "round",
          join: "round",
          user: [],
        };
        objects.set(u32(8), { kind: "pen", pen });
        break;
      }
      case 95: {
        // EXTCREATEPEN: LOGPEN_EX — type, end cap and join in the style's upper bits.
        const style = u32(28);
        const geometric = (style & 0xf0000) === 0x10000;
        const brushStyle = u32(36);
        const count = u32(48);
        const user: number[] = [];
        for (let i = 0; i < count && 52 + 4 * i + 4 <= size; i += 1) user.push(u32(52 + 4 * i));
        const pen: Pen = {
          style: brushStyle === BS_NULL ? PS_NULL : style & 0xf,
          width: geometric ? u32(32) : 0,
          color: colorRef(u32(40)),
          cosmetic: !geometric,
          cap: (["round", "square", "butt"] as const)[(style >> 8) & 0xf] ?? "round",
          join: (["round", "bevel", "miter"] as const)[(style >> 12) & 0xf] ?? "round",
          user,
        };
        objects.set(u32(8), { kind: "pen", pen });
        break;
      }
      case 39: {
        // CREATEBRUSHINDIRECT: LOGBRUSH32
        const style = u32(12);
        const brush: Brush = {
          style: style === BS_NULL || style === BS_HATCHED ? style : BS_SOLID,
          color: colorRef(u32(16)),
          hatch: u32(20),
          pattern: null,
        };
        objects.set(u32(8), { kind: "brush", brush });
        break;
      }
      case 93: // CREATEMONOBRUSH
      case 94: {
        // CREATEDIBPATTERNBRUSHPT
        const more: DibOptions = type === 93 ? { mono: [dc().textColor, dc().bkColor] } : {};
        objects.set(u32(8), { kind: "brush", brush: patternBrush(dib(u32(16), u32(20), u32(24), u32(28), u32(12), more)?.source ?? null) });
        break;
      }
      case 82: // EXTCREATEFONTINDIRECTW
        objects.set(u32(8), { kind: "font", font: logFont(v, at + 12) });
        break;
      case 49: {
        // CREATEPALETTE: LOGPALETTE — version, count, then r g b flags.
        const count = v.getUint16(at + 14, true);
        const colors: number[] = [];
        for (let i = 0; i < count && 16 + 4 * i + 4 <= size; i += 1) {
          const o = at + 16 + 4 * i;
          colors.push((bytes[o]! << 16) | (bytes[o + 1]! << 8) | bytes[o + 2]!);
        }
        objects.set(u32(8), { kind: "palette", colors });
        break;
      }
      case 48: // SELECTPALETTE
        canvas.select(u32(8) & 0x80000000 ? null : objects.get(u32(8)));
        break;
      case 40: // DELETEOBJECT
        objects.delete(u32(8));
        break;
      case 41: // ANGLEARC
        canvas.angleArc(i32(8), i32(12), u32(16), f32(20), f32(24));
        break;
      case 42: // ELLIPSE
        canvas.ellipse(...rect(8));
        break;
      case 43: // RECTANGLE
        canvas.rectangle(...rect(8));
        break;
      case 44: // ROUNDRECT
        canvas.roundRect(...rect(8), i32(24), i32(28));
        break;
      case 45: // ARC
        canvas.arc("arc", rect(8), point(24), point(32));
        break;
      case 46: // CHORD
        canvas.arc("chord", rect(8), point(24), point(32));
        break;
      case 47: // PIE
        canvas.arc("pie", rect(8), point(24), point(32));
        break;
      case 55: // ARCTO
        canvas.arcTo(rect(8), point(24), point(32));
        break;
      case 54: // LINETO
        canvas.lineTo(i32(8), i32(12));
        break;
      case 57: // SETARCDIRECTION
        dc().clockwise = u32(8) === 2;
        break;
      case 58: // SETMITERLIMIT
        dc().miterLimit = u32(8);
        break;
      case 59: // BEGINPATH
        canvas.beginPath();
        break;
      case 60: // ENDPATH
        canvas.endPath();
        break;
      case 61: // CLOSEFIGURE
        canvas.closeFigure();
        break;
      case 62: // FILLPATH
        canvas.usePath(true, false);
        break;
      case 63: // STROKEANDFILLPATH
        canvas.usePath(true, true);
        break;
      case 64: // STROKEPATH
        canvas.usePath(false, true);
        break;
      case 67: // SELECTCLIPPATH
        canvas.clipToPath(u32(8));
        break;
      case 68: // ABORTPATH
        canvas.abortPath();
        break;
      case 70:
        // COMMENT: EMF+ records ride in these; any other comment is the writer's own business.
        if (size >= 16 && u32(12) === EMFPLUS_SIGNATURE) {
          fallback = plus.comment(bytes, at + 16, at + 12 + Math.min(u32(8), size - 12), canvas);
        }
        break;
      case 71: // FILLRGN: logical rectangles in a brush
      case 74: {
        // PAINTRGN: in the current brush
        const data = type === 71 ? 32 : 28;
        const saved = dc().brush;
        if (type === 71) canvas.select(objects.get(u32(28)) ?? stockObject(u32(28) & 0x7fffffff));
        canvas.regionShape(regionRects(v, at + data, u32(24)), true, false);
        dc().brush = saved;
        break;
      }
      case 75: // EXTSELECTCLIPRGN: device-space rectangles
        canvas.clipRegion(u32(8) >= 32 ? regionRects(v, at + 16, u32(8)) : [], u32(12));
        break;
      case 76: // BITBLT
      case 77: // STRETCHBLT
      case 114: {
        // ALPHABLEND
        const dest = [i32(24), i32(28), i32(32), i32(36)] as const;
        const blend = u32(40);
        const alpha = type === 114 && ((blend >>> 24) & 0xff & AC_SRC_ALPHA) !== 0;
        const source = dib(u32(84), u32(88), u32(92), u32(96), u32(80), { alpha })?.source ?? null;
        // The source rectangle is in the source DC's logical units: its XFORM takes it to the
        // bitmap's pixels.
        const sx = xform(f32, 52);
        const sw = type === 76 ? dest[2] : i32(100);
        const sh = type === 76 ? dest[3] : i32(104);
        const x0 = i32(44) * sx[0] + i32(48) * sx[2] + sx[4];
        const y0 = i32(44) * sx[1] + i32(48) * sx[3] + sx[5];
        const src = [x0, y0, sw * sx[0] + sh * sx[2], sw * sx[1] + sh * sx[3]] as const;
        if (type === 114) canvas.blit(source, dest, src, 0x00cc0020, ((blend >>> 16) & 0xff) / 255);
        else canvas.blit(source, dest, src, u32(40));
        break;
      }
      case 81: // STRETCHDIBITS
      case 80: {
        // SETDIBITSTODEVICE: the same, one source pixel per logical unit. Both count a bottom-up
        // DIB's source rows from its bottom edge.
        const bitmap = dib(u32(48), u32(52), u32(56), u32(60), u32(64));
        if (!bitmap) break;
        const ySrc = bitmap.topDown ? i32(36) : bitmap.height - i32(36) - i32(44);
        const src = [i32(32), ySrc, i32(40), i32(44)] as const;
        const dest = [i32(24), i32(28), type === 81 ? i32(72) : i32(40), type === 81 ? i32(76) : i32(44)] as const;
        canvas.blit(bitmap.source, dest, src, type === 81 ? u32(68) : 0x00cc0020);
        break;
      }
      case 83: // EXTTEXTOUTA
      case 84: {
        // EXTTEXTOUTW: EMRTEXT at 36.
        const count = u32(44);
        const options = u32(52);
        if (options & ETO_GLYPH_INDEX) break; // glyph ids of a font this machine may not have
        const wide = type === 84;
        const start = at + u32(48);
        const raw = bytes.subarray(start, start + count * (wide ? 2 : 1));
        const text = wide ? Buffer.from(raw).toString("utf16le") : decodeAnsi(raw, dc().font);
        const offDx = u32(72);
        let advances: number[] | null = null;
        if (offDx > 0) {
          const step = options & ETO_PDY ? 8 : 4;
          advances = [];
          for (let i = 0; i < count && offDx + i * step + 4 <= size; i += 1) advances.push(i32(offDx + i * step));
        }
        canvas.text({
          x: i32(36),
          y: i32(40),
          text,
          advances,
          options,
          rect: options & (ETO_OPAQUE | ETO_CLIPPED) ? rect(56) : null,
          advanced: u32(24) === 2,
        });
        break;
      }
      // Everything else (palettes' realisation, ICM, mapper flags, brush origin, stretch mode,
      // flood fills, gradients …) either changes nothing an SVG can show or is not in any
      // metafile seen so far.
    }
    if (type === EMR_EOF) break;
    at += size;
  }
  if (plus.seen && !plus.dual && plus.drawing) return null;
  return canvas.svg();
}

/** XFORM: eM11 eM12 eM21 eM22 eDx eDy — the same order as an SVG matrix. */
function xform(f32: (o: number) => number, o: number): Matrix {
  const m = [f32(o), f32(o + 4), f32(o + 8), f32(o + 12), f32(o + 16), f32(o + 20)] as const;
  return m.every(Number.isFinite) ? m : IDENTITY;
}

/** LOGFONTW ([MS-WMF] 2.2.1.2's wide twin): 5 LONGs, 8 BYTEs, a 32-WCHAR face name. */
function logFont(v: DataView, at: number): Font {
  let face = "";
  for (let i = 0; i < 32; i += 1) {
    const c = v.getUint16(at + 28 + i * 2, true);
    if (c === 0) break;
    face += String.fromCharCode(c);
  }
  return {
    height: v.getInt32(at, true),
    width: v.getInt32(at + 4, true),
    escapement: v.getInt32(at + 8, true),
    weight: v.getInt32(at + 16, true),
    italic: v.getUint8(at + 20) !== 0,
    underline: v.getUint8(at + 21) !== 0,
    strikeOut: v.getUint8(at + 22) !== 0,
    charset: v.getUint8(at + 23),
    pitchAndFamily: v.getUint8(at + 27),
    face,
  };
}

/** RegionData ([MS-EMF] 2.2.24): a 32-byte RGNDATAHEADER, then `nCount` RECTLs. */
function regionRects(v: DataView, at: number, size: number): number[] {
  const count = Math.min(v.getUint32(at + 8, true), Math.floor((size - 32) / 16));
  const rects: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const o = at + 32 + i * 16;
    rects.push(v.getInt32(o, true), v.getInt32(o + 4, true), v.getInt32(o + 8, true), v.getInt32(o + 12, true));
  }
  return rects;
}

