import {
  BS_HATCHED,
  BS_NULL,
  BS_SOLID,
  Canvas,
  ETO_CLIPPED,
  ETO_OPAQUE,
  MM_ANISOTROPIC,
  PS_SOLID,
  RGN_COPY,
  colorRef,
  decodeAnsi,
  patternBrush,
  type Brush,
  type Font,
  type GdiObject,
  type Pen,
} from "./canvas";
import { dibBitsOffset, dibSize, readDib } from "./dib";

/**
 * A Windows Metafile ([MS-WMF]) played onto a `Canvas`.
 *
 * A WMF has no frame of its own: the host sets up the viewport and the file sets the window
 * (SetWindowOrg/SetWindowExt) that maps onto it. So the picture is the window in effect when the
 * first thing is drawn — not the Aldus placeable header's bounding box, which only says how big
 * the picture is (and often disagrees with the window by a few percent, or names it with y
 * pointing up). The viewport is that window's size, so device space is the window shifted to
 * (0, 0); a later SetWindowExt rescales what follows, as it does under GDI. Without a window the
 * placeable bounding box stands in for it.
 *
 * Every 16-bit field here is signed, and points come (y, x) in most records — the order of the
 * GDI call's arguments, pushed right to left.
 */

const PLACEABLE_KEY = 0x9ac6cdd7;

const META_EOF = 0x0000;
/** Records that draw: the window in effect at the first of them is the picture. */
const DRAWING = new Set([
  0x0213, 0x0817, 0x0830, 0x081a, 0x0418, 0x041b, 0x061c, 0x0324, 0x0325, 0x0538, 0x0521, 0x0a32, 0x061d, 0x0940,
  0x0b41, 0x0f43, 0x041f, 0x0228, 0x0429, 0x012b, 0x0d33,
]);

export function isWmf(bytes: Uint8Array): boolean {
  if (bytes.length < 18) return false;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const at = v.getUint32(0, true) === PLACEABLE_KEY ? 22 : 0;
  if (bytes.length < at + 18) return false;
  const type = v.getUint16(at, true);
  return (type === 1 || type === 2) && v.getUint16(at + 2, true) === 9;
}

export function wmfToSvg(bytes: Uint8Array): string | null {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const placeable = v.getUint32(0, true) === PLACEABLE_KEY;
  const bbox = placeable ? [6, 8, 10, 12].map((o) => v.getInt16(o, true)) : null;
  const inch = placeable ? v.getUint16(14, true) : 0;
  const first = (placeable ? 22 : 0) + 18;

  // The window the first drawing record sees.
  let org = { x: 0, y: 0 };
  let ext: { x: number; y: number } | null = null;
  for (let at = first; at + 6 <= bytes.length; ) {
    const size = v.getUint32(at, true) * 2;
    const fn = v.getUint16(at + 4, true);
    if (fn === META_EOF || size < 6 || at + size > bytes.length || DRAWING.has(fn)) break;
    if (fn === 0x020b) org = { x: v.getInt16(at + 8, true), y: v.getInt16(at + 6, true) };
    if (fn === 0x020c) ext = { x: v.getInt16(at + 8, true), y: v.getInt16(at + 6, true) };
    at += size;
  }
  if (!ext || ext.x === 0 || ext.y === 0) {
    if (!bbox) return null;
    org = { x: bbox[0]!, y: bbox[1]! };
    ext = { x: bbox[2]! - bbox[0]!, y: bbox[3]! - bbox[1]! };
    if (ext.x === 0 || ext.y === 0) return null;
  }
  const view = { x: 0, y: 0, w: Math.abs(ext.x), h: Math.abs(ext.y) };
  // Natural size: the placeable header's inches, else one logical unit per twip.
  const perInch = inch > 0 && bbox ? inch : 1440;
  const size = bbox && inch > 0 ? { w: Math.abs(bbox[2]! - bbox[0]!), h: Math.abs(bbox[3]! - bbox[1]!) } : view;
  const canvas = new Canvas(view, { w: (size.w * 96) / perInch, h: (size.h * 96) / perInch }, { x: 1, y: 1 });
  const dc = (): Canvas["dc"] => canvas.dc;
  dc().mapMode = MM_ANISOTROPIC;
  dc().winOrg = org;
  dc().winExt = ext;
  dc().vpExt = { x: view.w, y: view.h };

  // WMF objects take the lowest free slot when created; records then name them by slot.
  const objects: (GdiObject | undefined)[] = [];
  const create = (object: GdiObject): void => {
    let slot = objects.indexOf(undefined);
    if (slot < 0) slot = objects.length;
    objects[slot] = object;
  };

  for (let at = first; at + 6 <= bytes.length; ) {
    const size = v.getUint32(at, true) * 2;
    const fn = v.getUint16(at + 4, true);
    if (fn === META_EOF || size < 6 || at + size > bytes.length) break;
    const s16 = (o: number): number => v.getInt16(at + 6 + o, true);
    const u16 = (o: number): number => v.getUint16(at + 6 + o, true);
    const u32 = (o: number): number => v.getUint32(at + 6 + o, true);
    const points = (o: number, count: number): Int16Array => {
      const n = Math.max(0, Math.min(count, Math.floor((size - 6 - o) / 4)));
      const out = new Int16Array(n * 2);
      for (let i = 0; i < n * 2; i += 1) out[i] = s16(o + i * 2);
      return out;
    };
    /** Four shorts stored bottom, right, top, left. */
    const box = (o: number): [number, number, number, number] => [s16(o + 6), s16(o + 4), s16(o + 2), s16(o)];
    /** A DIB packed right after the fixed fields, starting at `o`, with its height and row order;
     *  `null` when it cannot be read — which costs that bitmap, not the picture. */
    const packedDib = (o: number, usage: number) => {
      const info = bytes.subarray(at + 6 + o, at + size);
      try {
        const source = readDib(info, info.subarray(dibBitsOffset(info, usage)), { usage, palette: dc().palette });
        return { source, ...dibSize(info) };
      } catch {
        return null;
      }
    };

    switch (fn) {
      case 0x0201: // SETBKCOLOR
        dc().bkColor = colorRef(u32(0));
        break;
      case 0x0102: // SETBKMODE
        dc().bkMode = u16(0);
        break;
      case 0x0104: // SETROP2
        dc().rop2 = u16(0);
        break;
      case 0x0106: // SETPOLYFILLMODE
        dc().polyFill = u16(0);
        break;
      case 0x0209: // SETTEXTCOLOR
        dc().textColor = colorRef(u32(0));
        break;
      case 0x012e: // SETTEXTALIGN
        dc().textAlign = u16(0);
        break;
      case 0x020b: // SETWINDOWORG
        dc().winOrg = { x: s16(2), y: s16(0) };
        break;
      case 0x020c: // SETWINDOWEXT
        dc().winExt = { x: s16(2), y: s16(0) };
        break;
      case 0x020f: {
        // OFFSETWINDOWORG
        const o = dc().winOrg;
        dc().winOrg = { x: o.x + s16(2), y: o.y + s16(0) };
        break;
      }
      case 0x0410: // SCALEWINDOWEXT
      case 0x0412: {
        // SCALEVIEWPORTEXT: yDenom, yNum, xDenom, xNum
        const key = fn === 0x0410 ? "winExt" : "vpExt";
        const e = dc()[key];
        if (s16(0) !== 0 && s16(4) !== 0) dc()[key] = { x: (e.x * s16(6)) / s16(4), y: (e.y * s16(2)) / s16(0) };
        break;
      }
      case 0x0211: {
        // OFFSETVIEWPORTORG
        const o = dc().vpOrg;
        dc().vpOrg = { x: o.x + s16(2), y: o.y + s16(0) };
        break;
      }
      // SETMAPMODE, SETVIEWPORTORG and SETVIEWPORTEXT are the host's business: it maps the
      // window onto the picture's frame, and a file that says otherwise would only pull the
      // picture off it.
      case 0x001e: // SAVEDC
        canvas.save();
        break;
      case 0x0127: // RESTOREDC
        canvas.restore(s16(0));
        break;
      case 0x0214: // MOVETO
        canvas.moveTo(s16(2), s16(0));
        break;
      case 0x0213: // LINETO
        canvas.lineTo(s16(2), s16(0));
        break;
      case 0x0415: // EXCLUDECLIPRECT
      case 0x0416: {
        // INTERSECTCLIPRECT
        const [l, t, r, b] = box(0);
        canvas.clipRect(l, t, r, b, fn === 0x0415);
        break;
      }
      case 0x0418: // ELLIPSE
        canvas.ellipse(...box(0));
        break;
      case 0x041b: // RECTANGLE
        canvas.rectangle(...box(0));
        break;
      case 0x061c: // ROUNDRECT: height, width, then the box
        canvas.roundRect(...box(4), s16(2), s16(0));
        break;
      case 0x0817: // ARC
      case 0x0830: // CHORD
      case 0x081a: {
        // PIE: yEnd, xEnd, yStart, xStart, then the box
        const kind = fn === 0x0817 ? "arc" : fn === 0x0830 ? "chord" : "pie";
        canvas.arc(kind, box(8), { x: s16(6), y: s16(4) }, { x: s16(2), y: s16(0) });
        break;
      }
      case 0x0324: // POLYGON
        canvas.polygon(points(2, s16(0)));
        break;
      case 0x0325: // POLYLINE
        canvas.polyline(points(2, s16(0)));
        break;
      case 0x0538: {
        // POLYPOLYGON: count, the polygons' sizes, then all the points.
        const n = u16(0);
        const polys: Int16Array[] = [];
        let p = 2 + 2 * n;
        for (let i = 0; i < n; i += 1) {
          const count = u16(2 + 2 * i);
          polys.push(points(p, count));
          p += count * 4;
        }
        canvas.polyPolygon(polys);
        break;
      }
      case 0x041f: // SETPIXEL: colour, y, x
        canvas.setPixel(s16(6), s16(4), colorRef(u32(0)));
        break;
      case 0x0521: {
        // TEXTOUT: length, string (word-padded), y, x
        const length = s16(0);
        const pad = length + (length & 1);
        const text = decodeAnsi(bytes.subarray(at + 8, at + 8 + length), dc().font);
        canvas.text({ x: s16(4 + pad), y: s16(2 + pad), text, advances: null, options: 0, rect: null, advanced: false });
        break;
      }
      case 0x0a32: {
        // EXTTEXTOUT: y, x, length, options, [rect], string (word-padded), [dx]
        const length = s16(4);
        const options = u16(6);
        const hasRect = (options & (ETO_OPAQUE | ETO_CLIPPED)) !== 0;
        const textAt = hasRect ? 16 : 8;
        const text = decodeAnsi(bytes.subarray(at + 6 + textAt, at + 6 + textAt + length), dc().font);
        const dxAt = textAt + length + (length & 1);
        const advances = 6 + dxAt + length * 2 <= size ? Array.from({ length }, (_, i) => s16(dxAt + i * 2)) : null;
        canvas.text({
          x: s16(2),
          y: s16(0),
          text,
          advances,
          options,
          rect: hasRect ? [s16(8), s16(10), s16(12), s16(14)] : null,
          advanced: false,
        });
        break;
      }
      case 0x061d: // PATBLT: rop, height, width, y, x
        canvas.blit(null, [s16(10), s16(8), s16(6), s16(4)], null, u32(0));
        break;
      case 0x0940: // DIBBITBLT: rop, ySrc, xSrc, height, width, yDest, xDest, [DIB]
      case 0x0b41: {
        // DIBSTRETCHBLT: rop, srcHeight, srcWidth, ySrc, xSrc, destHeight, destWidth, yDest, xDest, [DIB]
        const stretch = fn === 0x0b41;
        // Without a bitmap the record has one reserved word before the destination.
        const bare = size === ((fn >> 8) + 3) * 2;
        const d = stretch ? 12 : 8;
        const o = bare ? d + 2 : d;
        const dest = [s16(o + 6), s16(o + 4), s16(o + 2), s16(o)] as const;
        if (bare) {
          canvas.blit(null, dest, null, u32(0));
          break;
        }
        const src = stretch ? ([s16(10), s16(8), s16(6), s16(4)] as const) : ([s16(6), s16(4), dest[2], dest[3]] as const);
        canvas.blit(packedDib(o + 8, 0)?.source ?? null, dest, src, u32(0));
        break;
      }
      case 0x0f43: {
        // STRETCHDIB: rop, usage, srcHeight, srcWidth, ySrc, xSrc, destHeight, destWidth, yDest, xDest, DIB
        // Like StretchDIBits, it counts a bottom-up DIB's source rows from its bottom edge.
        const bitmap = packedDib(22, u16(4));
        if (!bitmap) break;
        const ySrc = bitmap.topDown ? s16(10) : bitmap.height - s16(10) - s16(6);
        canvas.blit(bitmap.source, [s16(20), s16(18), s16(16), s16(14)], [s16(12), ySrc, s16(8), s16(6)], u32(0));
        break;
      }
      case 0x012d: // SELECTOBJECT
        canvas.select(objects[u16(0)]);
        break;
      case 0x0234: // SELECTPALETTE
        canvas.select(objects[u16(0)]);
        break;
      case 0x01f0: // DELETEOBJECT
        objects[u16(0)] = undefined;
        break;
      case 0x02fa: {
        // CREATEPENINDIRECT: style, width (a POINTS, only x counts), colour
        const style = u16(0) & 0xf;
        const width = Math.abs(s16(2));
        const pen: Pen = {
          style: width > 1 && style >= 1 && style <= 4 ? PS_SOLID : style,
          width,
          color: colorRef(u32(6)),
          cosmetic: width === 0,
          cap: "round",
          join: "round",
          user: [],
        };
        create({ kind: "pen", pen });
        break;
      }
      case 0x02fc: {
        // CREATEBRUSHINDIRECT: style, colour, hatch
        const style = u16(0);
        const brush: Brush = {
          style: style === BS_NULL || style === BS_HATCHED ? style : BS_SOLID,
          color: colorRef(u32(2)),
          hatch: u16(6),
          pattern: null,
        };
        create({ kind: "brush", brush });
        break;
      }
      case 0x0142: {
        // DIBCREATEPATTERNBRUSH: style, usage, DIB
        // Even an unreadable one takes its slot: later records count on the numbering.
        create({ kind: "brush", brush: patternBrush(packedDib(4, u16(2))?.source ?? null) });
        break;
      }
      case 0x02fb: // CREATEFONTINDIRECT
        create({ kind: "font", font: logFont16(v, at + 6, size - 6) });
        break;
      case 0x00f7: {
        // CREATEPALETTE: start, count, then r g b flags
        const count = u16(2);
        const colors: number[] = [];
        for (let i = 0; i < count && 6 + 4 + i * 4 + 4 <= size; i += 1) {
          const o = at + 10 + i * 4;
          colors.push((bytes[o]! << 16) | (bytes[o + 1]! << 8) | bytes[o + 2]!);
        }
        create({ kind: "palette", colors });
        break;
      }
      case 0x06ff: // CREATEREGION
        create({ kind: "region", rects: region16(v, at + 6, size - 6) });
        break;
      case 0x01f9: // CREATEPATTERNBRUSH (a device-dependent bitmap): still takes a slot
        create({ kind: "brush", brush: { style: BS_SOLID, color: 0x808080, hatch: 0, pattern: null } });
        break;
      case 0x012c: {
        // SELECTCLIPREGION: a region object, whose rectangles are logical units here. GDI records
        // SelectClipRgn(NULL) — back to no clip — naming a slot that holds no region.
        const region = objects[u16(0)];
        canvas.clipRegion(region?.kind === "region" ? toDevice(canvas, region.rects) : [], RGN_COPY);
        break;
      }
      case 0x0228: // FILLREGION: region, brush
      case 0x012b: {
        // PAINTREGION: region, in the current brush
        const region = objects[u16(0)];
        if (region?.kind !== "region") break;
        const saved = dc().brush;
        if (fn === 0x0228) canvas.select(objects[u16(2)]);
        canvas.regionShape(region.rects, true, false);
        dc().brush = saved;
        break;
      }
      // ESCAPE, SETMAPPERFLAGS, SETRELABS, SETSTRETCHBLTMODE, SETTEXTJUSTIFICATION,
      // SETTEXTCHAREXTRA, REALIZEPALETTE, … change nothing an SVG can show.
    }
    at += size;
  }
  return canvas.svg();
}

/** A WMF LogFont: five shorts, eight bytes, then an ANSI face name. */
function logFont16(v: DataView, at: number, size: number): Font {
  let face = "";
  for (let i = 18; i < Math.min(size, 50); i += 1) {
    const c = v.getUint8(at + i);
    if (c === 0) break;
    face += String.fromCharCode(c);
  }
  return {
    height: v.getInt16(at, true),
    width: v.getInt16(at + 2, true),
    escapement: v.getInt16(at + 4, true),
    weight: v.getInt16(at + 8, true),
    italic: v.getUint8(at + 10) !== 0,
    underline: v.getUint8(at + 11) !== 0,
    strikeOut: v.getUint8(at + 12) !== 0,
    charset: v.getUint8(at + 13),
    pitchAndFamily: v.getUint8(at + 17),
    face,
  };
}

/** A WMF Region object ([MS-WMF] 2.2.1.5): a header, then scans of (left, right) pairs between a
 *  top and a bottom. Rectangles (l, t, r, b, …) in logical units. */
function region16(v: DataView, at: number, size: number): number[] {
  const scans = v.getInt16(at + 10, true);
  const rects: number[] = [];
  let p = 22;
  for (let s = 0; s < scans && p + 6 <= size; s += 1) {
    const count = v.getUint16(at + p, true);
    const top = v.getInt16(at + p + 2, true);
    const bottom = v.getInt16(at + p + 4, true);
    for (let i = 0; i + 1 < count && p + 6 + i * 2 + 4 <= size; i += 2) {
      rects.push(v.getInt16(at + p + 6 + i * 2, true), top, v.getInt16(at + p + 8 + i * 2, true), bottom);
    }
    p += 6 + count * 2 + 2;
  }
  return rects;
}

/** Logical rectangles to device space through the DC's mapping (no rotation in a WMF). */
function toDevice(canvas: Canvas, rects: readonly number[]): number[] {
  const m = canvas.matrix();
  const out: number[] = [];
  for (let i = 0; i + 3 < rects.length; i += 4) {
    const xs = [m[0] * rects[i]! + m[4], m[0] * rects[i + 2]! + m[4]];
    const ys = [m[3] * rects[i + 1]! + m[5], m[3] * rects[i + 3]! + m[5]];
    out.push(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys));
  }
  return out;
}
