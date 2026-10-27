import { crc32, deflateSync } from "node:zlib";

/**
 * Device-independent bitmaps ([MS-WMF] 2.2.2.9, the same structure EMF records carry) decoded to
 * RGBA, and RGBA encoded back to a PNG `data:` URI — an SVG used as an image cannot fetch anything,
 * so every bitmap a metafile draws has to travel inside the SVG itself.
 *
 * Everything reads through `DataView`, which throws on the first byte past the end: a truncated
 * DIB fails into the converter's single `catch` instead of being drawn from garbage.
 */

/** Straight (not premultiplied) RGBA, top row first. */
export type Raster = { width: number; height: number; rgba: Uint8Array };

/** A bitmap ready for `<image href>`: its pixel size and the URI. */
export type Picture = { width: number; height: number; href: string };

const BI_RGB = 0;
const BI_RLE8 = 1;
const BI_RLE4 = 2;
const BI_BITFIELDS = 3;
const BI_JPEG = 4;
const BI_PNG = 5;
const BI_ALPHABITFIELDS = 6;

const DIB_PAL_COLORS = 1;

/** Past this a bitmap is not decoded: a hostile header must not allocate gigabytes. Real metafiles
 *  in the corpus stay under 30 megapixels. */
const MAX_PIXELS = 64 * 1024 * 1024;

type DibHeader = {
  width: number;
  height: number;
  topDown: boolean;
  bitCount: number;
  compression: number;
  /** Where the colour table starts, and how many entries it has. */
  tableAt: number;
  tableSize: number;
  /** 3 bytes per entry (`BITMAPCOREHEADER`) or 4. */
  tableStride: number;
  masks: [number, number, number, number] | null;
};

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function readHeader(info: Uint8Array): DibHeader {
  const v = view(info);
  const size = v.getUint32(0, true);
  if (size === 12) {
    // BITMAPCOREHEADER (OS/2): 16-bit sizes, RGBTRIPLE colours, always bottom-up and uncompressed.
    const bitCount = v.getUint16(10, true);
    return {
      width: v.getUint16(4, true),
      height: v.getUint16(6, true),
      topDown: false,
      bitCount,
      compression: BI_RGB,
      tableAt: 12,
      tableSize: bitCount <= 8 ? 1 << bitCount : 0,
      tableStride: 3,
      masks: null,
    };
  }
  if (size < 40) throw new RangeError("DIB: unknown header");
  const width = v.getInt32(4, true);
  const height = v.getInt32(8, true);
  const bitCount = v.getUint16(14, true);
  const compression = v.getUint32(16, true);
  const used = v.getUint32(32, true);
  let tableAt = size;
  let masks: DibHeader["masks"] = null;
  if (compression === BI_BITFIELDS || compression === BI_ALPHABITFIELDS) {
    // A plain BITMAPINFOHEADER keeps the masks right after itself, where a colour table would be;
    // V4/V5 headers have them inside.
    const at = size >= 52 ? 40 : size;
    masks = [v.getUint32(at, true), v.getUint32(at + 4, true), v.getUint32(at + 8, true), 0];
    if (size >= 56 || compression === BI_ALPHABITFIELDS) masks[3] = v.getUint32(at + 12, true);
    if (size < 52) tableAt += compression === BI_ALPHABITFIELDS ? 16 : 12;
  }
  return {
    width,
    height: Math.abs(height),
    topDown: height < 0,
    bitCount,
    compression,
    tableAt,
    tableSize: bitCount <= 8 ? used || 1 << bitCount : 0,
    tableStride: 4,
    masks,
  };
}

/** The byte size of a packed DIB's header and colour table: where its pixels start. */
export function dibBitsOffset(info: Uint8Array, usage: number): number {
  const h = readHeader(info);
  return h.tableAt + h.tableSize * (usage === DIB_PAL_COLORS ? 2 : h.tableStride);
}

/** Pixel size of a DIB without decoding it, and whether its rows are stored top row first. */
export function dibSize(info: Uint8Array): { width: number; height: number; topDown: boolean } {
  const h = readHeader(info);
  return { width: h.width, height: h.height, topDown: h.topDown };
}

/**
 * A DIB as a picture for `<image>`, cropped to `src` (pixels, top-left origin). JPEG and PNG
 * DIBs (`BI_JPEG`/`BI_PNG`) are their own file and go through as they are, uncropped.
 *
 * `palette` resolves `DIB_PAL_COLORS` tables (indices into the selected logical palette);
 * `alpha` keeps a 32-bit DIB's fourth byte as premultiplied alpha — only `AlphaBlend` with
 * `AC_SRC_ALPHA` means it: everywhere else GDI ignores that byte, and writers leave it 0.
 */
export type DibOptions = { usage?: number; palette?: readonly number[] | null; alpha?: boolean; mono?: [number, number] };

export function readDib(info: Uint8Array, bits: Uint8Array, options: DibOptions): Raster | { encoded: Picture } {
  const h = readHeader(info);
  if (h.compression === BI_JPEG || h.compression === BI_PNG) {
    const mime = h.compression === BI_PNG ? "image/png" : "image/jpeg";
    return { encoded: { width: h.width, height: h.height, href: `data:${mime};base64,${Buffer.from(bits).toString("base64")}` } };
  }
  if (h.width <= 0 || h.height <= 0 || h.width * h.height > MAX_PIXELS) throw new RangeError("DIB: bad size");
  const table = colourTable(info, h, options.usage ?? 0, options.palette ?? null, options.mono);
  const { width, height } = h;
  const rgba = new Uint8Array(width * height * 4);
  const put = (row: number, x: number, colour: number, a = 255): void => {
    const y = h.topDown ? row : height - 1 - row;
    const at = (y * width + x) * 4;
    rgba[at] = (colour >> 16) & 0xff;
    rgba[at + 1] = (colour >> 8) & 0xff;
    rgba[at + 2] = colour & 0xff;
    rgba[at + 3] = a;
  };
  if (h.compression === BI_RLE8 || h.compression === BI_RLE4) {
    const indices = unpackRle(bits, width, height, h.compression === BI_RLE4);
    for (let row = 0; row < height; row += 1) {
      for (let x = 0; x < width; x += 1) put(row, x, table[indices[row * width + x]!] ?? 0);
    }
    return { width, height, rgba };
  }
  const stride = (((width * h.bitCount + 31) >> 5) << 2) >>> 0;
  if (bits.length < stride * (height - 1) + Math.ceil((width * h.bitCount) / 8)) throw new RangeError("DIB: short bits");
  const v = view(bits);
  const masks = h.masks ?? (h.bitCount === 16 ? [0x7c00, 0x03e0, 0x001f, 0] : [0xff0000, 0x00ff00, 0x0000ff, 0]);
  const channel = masks.map(maskShape);
  for (let row = 0; row < height; row += 1) {
    const line = row * stride;
    for (let x = 0; x < width; x += 1) {
      switch (h.bitCount) {
        case 1:
          put(row, x, table[(bits[line + (x >> 3)]! >> (7 - (x & 7))) & 1] ?? 0);
          break;
        case 4:
          put(row, x, table[(bits[line + (x >> 1)]! >> (x & 1 ? 0 : 4)) & 0xf] ?? 0);
          break;
        case 8:
          put(row, x, table[bits[line + x]!] ?? 0);
          break;
        case 24: {
          const at = line + x * 3;
          put(row, x, (bits[at + 2]! << 16) | (bits[at + 1]! << 8) | bits[at]!);
          break;
        }
        case 16:
        case 32: {
          const raw = h.bitCount === 16 ? v.getUint16(line + x * 2, true) : v.getUint32(line + x * 4, true);
          const [r, g, b, a] = channel.map((c) => c(raw)) as [number, number, number, number];
          if (options.alpha && h.bitCount === 32) {
            const alpha = h.masks && h.masks[3] ? a : raw >>> 24;
            // Premultiplied in, straight out (the PNG is straight).
            const un = (c: number): number => (alpha === 0 ? 0 : Math.min(255, Math.round((c * 255) / alpha)));
            put(row, x, (un(r) << 16) | (un(g) << 8) | un(b), alpha);
          } else {
            put(row, x, (r << 16) | (g << 8) | b);
          }
          break;
        }
        default:
          throw new RangeError("DIB: unsupported bit count");
      }
    }
  }
  return { width, height, rgba };
}

/** The colour table as 0xRRGGBB. A monochrome DIB with `mono` takes those two colours instead —
 *  how GDI draws a 1-bit pattern brush: 0 bits in the text colour, 1 bits in the background. */
function colourTable(
  info: Uint8Array,
  h: DibHeader,
  usage: number,
  palette: readonly number[] | null,
  mono: [number, number] | undefined,
): number[] {
  if (h.bitCount === 1 && mono) return mono;
  const v = view(info);
  const table: number[] = [];
  for (let i = 0; i < h.tableSize; i += 1) {
    if (usage === DIB_PAL_COLORS) {
      table.push(palette?.[v.getUint16(h.tableAt + i * 2, true)] ?? 0);
    } else {
      const at = h.tableAt + i * h.tableStride;
      table.push((info[at + 2]! << 16) | (info[at + 1]! << 8) | info[at]!);
    }
  }
  return table;
}

/** A channel mask as an extractor scaling its bits to 0–255 (5-bit 31 → 255, not 248). */
function maskShape(mask: number): (raw: number) => number {
  if (mask === 0) return () => 0;
  let shift = 0;
  while (((mask >>> shift) & 1) === 0) shift += 1;
  const max = mask >>> shift;
  return (raw) => Math.round((((raw & mask) >>> shift) * 255) / max);
}

/** BI_RLE8/BI_RLE4 ([MS-WMF] 3.1.6) to one palette index per pixel, top row first. Skipped
 *  pixels stay index 0, as GDI leaves them (in practice the background). */
function unpackRle(bits: Uint8Array, width: number, height: number, four: boolean): Uint8Array {
  const out = new Uint8Array(width * height);
  let x = 0;
  let y = 0;
  let at = 0;
  const set = (value: number): void => {
    if (x < width && y < height) out[(height - 1 - y) * width + x] = value;
    x += 1;
  };
  while (at + 1 < bits.length && y < height) {
    const count = bits[at]!;
    const value = bits[at + 1]!;
    at += 2;
    if (count > 0) {
      for (let i = 0; i < count; i += 1) set(four ? (i & 1 ? value & 0xf : value >> 4) : value);
    } else if (value === 0) {
      x = 0;
      y += 1;
    } else if (value === 1) {
      break;
    } else if (value === 2) {
      x += bits[at] ?? 0;
      y += bits[at + 1] ?? 0;
      at += 2;
    } else {
      const bytes = four ? (value + 1) >> 1 : value;
      for (let i = 0; i < value; i += 1) {
        const b = bits[at + (four ? i >> 1 : i)] ?? 0;
        set(four ? (i & 1 ? b & 0xf : b >> 4) : b);
      }
      at += bytes + (bytes & 1);
    }
  }
  return out;
}

/** `src` cut out of `raster`, clamped to it; `null` when nothing is left. */
export function crop(raster: Raster, x: number, y: number, w: number, h: number): Raster | null {
  const x0 = Math.max(0, Math.round(x));
  const y0 = Math.max(0, Math.round(y));
  const x1 = Math.min(raster.width, Math.round(x + w));
  const y1 = Math.min(raster.height, Math.round(y + h));
  if (x1 <= x0 || y1 <= y0) return null;
  if (x0 === 0 && y0 === 0 && x1 === raster.width && y1 === raster.height) return raster;
  const width = x1 - x0;
  const rgba = new Uint8Array(width * (y1 - y0) * 4);
  for (let row = y0; row < y1; row += 1) {
    rgba.set(raster.rgba.subarray((row * raster.width + x0) * 4, (row * raster.width + x1) * 4), (row - y0) * width * 4);
  }
  return { width, height: y1 - y0, rgba };
}

const PNG_SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

/** RGBA as a PNG `data:` URI: truecolour, with an alpha channel only when a pixel needs one. Each
 *  row is "Sub"-filtered, which is nearly free and shrinks photographs — the bulk of metafile
 *  bitmaps — far more than no filter does. */
export function pngHref(raster: Raster): string {
  const { width, height, rgba } = raster;
  let opaque = true;
  for (let i = 3; i < rgba.length && opaque; i += 4) opaque = rgba[i] === 255;
  const channels = opaque ? 3 : 4;
  const row = width * channels;
  const raw = new Uint8Array((row + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const out = y * (row + 1);
    raw[out] = 1; // Sub
    for (let x = 0; x < width; x += 1) {
      for (let c = 0; c < channels; c += 1) {
        const value = rgba[(y * width + x) * 4 + c]!;
        const left = x > 0 ? rgba[(y * width + x - 1) * 4 + c]! : 0;
        raw[out + 1 + x * channels + c] = (value - left) & 0xff;
      }
    }
  }
  const ihdr = new Uint8Array(13);
  const v = view(ihdr);
  v.setUint32(0, width);
  v.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = opaque ? 2 : 6;
  const png = Buffer.concat([PNG_SIGNATURE, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", new Uint8Array(0))]);
  return `data:image/png;base64,${png.toString("base64")}`;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "latin1");
  const body = Buffer.concat([head.subarray(4), data]);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(body) >>> 0, 0);
  return Buffer.concat([head.subarray(0, 4), body, tail]);
}
