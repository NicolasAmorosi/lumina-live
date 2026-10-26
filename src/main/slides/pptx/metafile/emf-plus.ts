import { IDENTITY, compose, type Canvas, type Matrix } from "./canvas";
import type { Picture } from "./dib";

/**
 * The part of EMF+ ([MS-EMFPLUS], records inside EMR_COMMENT) this converter plays: pictures.
 *
 * Office writes EMF+ "dual" — every EMF+ drawing record is followed by GDI records that draw the
 * same thing — and for shapes, lines and text that GDI rendition is faithful (the corpus' dual
 * charts score exact). For a picture it is not: GDI+ writes it down to 16 or 8 bits per pixel, a
 * PNG with transparency becomes a 1-bit mask plus a grey 8-bit image, and some DrawImagePoints have
 * no GDI rendition at all. The EMF+ image object, though, is the original PNG or JPEG file. So
 * DrawImage/DrawImagePoints of such an image are drawn from it, and the GDI records that follow
 * (up to the next EMF+ comment) are skipped as its fallback.
 *
 * What this tracks to place a picture: the world transform (Set/Reset/Multiply/Translate/Scale/
 * Rotate, Save/Restore) and the page transform. EMF+ clipping is not applied: in the corpus a
 * picture's clip is its frame or a rectangle around it.
 */

const HEADER = 0x4001;
const GET_DC = 0x4004;
const OBJECT = 0x4008;
const DRAW_IMAGE = 0x401a;
const DRAW_IMAGE_POINTS = 0x401b;
const SAVE = 0x4025;
const RESTORE = 0x4026;
const SET_WORLD = 0x402a;
const RESET_WORLD = 0x402b;
const MULTIPLY_WORLD = 0x402c;
const TRANSLATE_WORLD = 0x402d;
const SCALE_WORLD = 0x402e;
const ROTATE_WORLD = 0x402f;
const SET_PAGE = 0x4030;

const OBJECT_IMAGE = 5;
const BITMAP = 1;
const COMPRESSED = 1;

/** Device pixels per page unit at a DPI: UnitDisplay/UnitPixel, Point, Inch, Document, Millimetre. */
const UNIT_PER_INCH: Record<number, number> = { 3: 72, 4: 1, 5: 300, 6: 25.4 };

export class EmfPlus {
  /** Whether the file has an EMF+ header, says it is dual, and draws anything in EMF+. */
  seen = false;
  dual = false;
  drawing = false;
  private dpi = { x: 96, y: 96 };
  private world: Matrix = IDENTITY;
  private page: Matrix = IDENTITY;
  private readonly saves = new Map<number, [Matrix, Matrix]>();
  private readonly images = new Map<number, Picture>();
  /** Objects split over several records (the C flag): total size and the bytes so far. */
  private readonly partial = new Map<number, { total: number; chunks: Uint8Array[]; size: number }>();

  /**
   * Plays one EMR_COMMENT's EMF+ records (`start`–`end` of `bytes`). Returns whether the GDI
   * records after it are the fallback of a picture just drawn, to be skipped.
   */
  comment(bytes: Uint8Array, start: number, end: number, canvas: Canvas): boolean {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let skip = false;
    for (let p = start; p + 12 <= end; ) {
      const type = v.getUint16(p, true);
      const flags = v.getUint16(p + 2, true);
      const size = v.getUint32(p + 4, true);
      const dataSize = v.getUint32(p + 8, true);
      if (size < 12 || p + size > end) break;
      const d = p + 12;
      const f32 = (o: number): number => v.getFloat32(d + o, true);
      const matrix = (o: number): Matrix => [f32(o), f32(o + 4), f32(o + 8), f32(o + 12), f32(o + 16), f32(o + 20)];
      /** Flag A (0x2000): the new transform applies after the current one, else before it. */
      const multiply = (m: Matrix): void => {
        if (m.every(Number.isFinite)) this.world = flags & 0x2000 ? compose(m, this.world) : compose(this.world, m);
      };
      switch (type) {
        case HEADER:
          this.seen = true;
          this.dual = (flags & 1) === 1;
          this.dpi = { x: v.getUint32(d + 8, true) || 96, y: v.getUint32(d + 12, true) || 96 };
          break;
        case GET_DC:
          // What follows is GDI drawing in its own right, not a fallback.
          skip = false;
          break;
        case SET_PAGE: {
          const perInch = UNIT_PER_INCH[flags & 0xff];
          const scale = f32(0);
          const sx = (perInch ? this.dpi.x / perInch : 1) * scale;
          const sy = (perInch ? this.dpi.y / perInch : 1) * scale;
          if (Number.isFinite(sx) && Number.isFinite(sy)) this.page = [sx, 0, 0, sy, 0, 0];
          break;
        }
        case SET_WORLD: {
          const m = matrix(0);
          if (m.every(Number.isFinite)) this.world = m;
          break;
        }
        case RESET_WORLD:
          this.world = IDENTITY;
          break;
        case MULTIPLY_WORLD:
          multiply(matrix(0));
          break;
        case TRANSLATE_WORLD:
          multiply([1, 0, 0, 1, f32(0), f32(4)]);
          break;
        case SCALE_WORLD:
          multiply([f32(0), 0, 0, f32(4), 0, 0]);
          break;
        case ROTATE_WORLD: {
          const a = (f32(0) * Math.PI) / 180;
          multiply([Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0]);
          break;
        }
        case SAVE:
          this.saves.set(v.getUint32(d, true), [this.world, this.page]);
          break;
        case RESTORE: {
          const saved = this.saves.get(v.getUint32(d, true));
          if (saved) [this.world, this.page] = saved;
          break;
        }
        case OBJECT:
          this.object(bytes, v, d, Math.min(dataSize, size - 12), flags);
          break;
        case DRAW_IMAGE:
        case DRAW_IMAGE_POINTS:
          this.drawing = true;
          skip = this.drawImage(v, d, flags, type === DRAW_IMAGE_POINTS, canvas);
          break;
        default:
          // Any other drawing record leaves its GDI fallback to draw.
          if (type >= 0x4009 && type <= 0x401c) {
            this.drawing = true;
            skip = false;
          }
      }
      p += size;
    }
    return skip;
  }

  /** EmfPlusObject: only images are kept; a continued object is assembled first. */
  private object(bytes: Uint8Array, v: DataView, d: number, length: number, flags: number): void {
    const id = flags & 0xff;
    let data: Uint8Array;
    if (flags & 0x8000) {
      // Every part carries the C flag and the total size; the object is whole once that is reached.
      const part = this.partial.get(id) ?? { total: v.getUint32(d, true), chunks: [], size: 0 };
      part.chunks.push(bytes.subarray(d + 4, d + length));
      part.size += length - 4;
      if (part.size < part.total) {
        this.partial.set(id, part);
        return;
      }
      this.partial.delete(id);
      data = Buffer.concat(part.chunks);
    } else {
      data = bytes.subarray(d, d + length);
    }
    this.images.delete(id);
    if (((flags >> 8) & 0x7f) !== OBJECT_IMAGE) return;
    const picture = compressedBitmap(data);
    if (picture) this.images.set(id, picture);
  }

  /** DrawImage (a destination rectangle) or DrawImagePoints (a parallelogram: upper-left,
   *  upper-right, lower-left); the source rectangle, in the picture's pixels, maps onto it. */
  private drawImage(v: DataView, d: number, flags: number, points: boolean, canvas: Canvas): boolean {
    const picture = this.images.get(flags & 0xff);
    if (!picture || flags & 0x0800) return false; // P: relative points, never seen
    const short = (flags & 0x4000) !== 0;
    const f32 = (o: number): number => v.getFloat32(d + o, true);
    const coord = (o: number, i: number): number => (short ? v.getInt16(d + o + i * 2, true) : v.getFloat32(d + o + i * 4, true));
    const [sx, sy, sw, sh] = [f32(8), f32(12), f32(16), f32(20)];
    let p: number[];
    if (points) {
      if (v.getUint32(d + 24, true) !== 3) return false;
      p = [0, 1, 2, 3, 4, 5].map((i) => coord(28, i));
    } else {
      const [x, y, w, h] = [0, 1, 2, 3].map((i) => coord(24, i)) as [number, number, number, number];
      p = [x, y, x + w, y, x, y + h];
    }
    const [x0 = 0, y0 = 0, x1 = 0, y1 = 0, x2 = 0, y2 = 0] = p;
    if (!(sw > 0 && sh > 0)) return false;
    const a = (x1 - x0) / sw;
    const b = (y1 - y0) / sw;
    const c = (x2 - x0) / sh;
    const e = (y2 - y0) / sh;
    const toWorld: Matrix = [a, b, c, e, x0 - a * sx - c * sy, y0 - b * sx - e * sy];
    const placed = compose(compose(this.page, this.world), toWorld);
    if (!placed.every(Number.isFinite)) return false;
    canvas.picture(picture, placed);
    return true;
  }
}

/**
 * An EmfPlusImage holding a compressed bitmap (EmfPlusBitmap type 1): a whole PNG or JPEG file.
 *
 * Not a CMYK JPEG: Chromium converts CMYK without a colour profile, far more saturated than what
 * Office shows (measured on the corpus' one: a slate (57, 49, 106) drawn as (0, 22, 195)), while
 * the GDI fallback carries GDI+'s own, colour-managed conversion. Raw pixel bitmaps and metafile
 * images are left to the fallback too — the corpus has none but one EMF+-only metafile, which
 * this converter could not draw anyway.
 */
function compressedBitmap(data: Uint8Array): Picture | null {
  if (data.length < 28) return null;
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (v.getUint32(4, true) !== BITMAP || v.getUint32(24, true) !== COMPRESSED) return null;
  const file = Buffer.from(data.buffer, data.byteOffset + 28, data.byteLength - 28);
  if (file.length > 24 && file.readUInt32BE(0) === 0x89504e47) {
    return { width: file.readUInt32BE(16), height: file.readUInt32BE(20), href: `data:image/png;base64,${file.toString("base64")}` };
  }
  const frame = file[0] === 0xff && file[1] === 0xd8 ? jpegFrame(file) : null;
  if (!frame || (frame.components !== 3 && frame.components !== 1)) return null;
  return { width: frame.width, height: frame.height, href: `data:image/jpeg;base64,${file.toString("base64")}` };
}

/** A JPEG's size and number of colour components, from its first SOFn marker. */
function jpegFrame(jpeg: Buffer): { width: number; height: number; components: number } | null {
  for (let at = 2; at + 9 < jpeg.length && jpeg[at] === 0xff; ) {
    const marker = jpeg[at + 1]!;
    if (marker === 0xff) {
      at += 1; // fill byte
    } else if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: jpeg.readUInt16BE(at + 5), width: jpeg.readUInt16BE(at + 7), components: jpeg[at + 9]! };
    } else {
      at += marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) ? 2 : 2 + jpeg.readUInt16BE(at + 2);
    }
  }
  return null;
}
