import { imagePixelSize } from "../native-deck";

const EMU_PER_INCH = 914400;

/**
 * A picture's natural size in EMU, as PowerPoint sizes a tile: its pixels at
 * its own DPI (JFIF density or PNG `pHYs`), 72 when it states none (measured
 * against PowerPoint's own tiling of a PNG with no `pHYs`). `null` for a
 * format whose header isn't read here.
 */
export function imageNaturalSize(bytes: Uint8Array): { w: number; h: number } | null {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const type = buf[0] === 0x89 && buf[1] === 0x50 ? "png" : buf[0] === 0xff && buf[1] === 0xd8 ? "jpeg" : null;
  if (!type) return null;
  const px = imagePixelSize(buf, type);
  if (!px) return null;
  const [dx, dy] = (type === "png" ? pngDpi(buf) : jpegDpi(buf)) ?? [72, 72];
  return { w: (px.width * EMU_PER_INCH) / dx, h: (px.height * EMU_PER_INCH) / dy };
}

function pngDpi(buf: Buffer): [number, number] | null {
  for (let at = 8; at + 12 <= buf.length; ) {
    const length = buf.readUInt32BE(at);
    const type = buf.toString("latin1", at + 4, at + 8);
    if (type === "pHYs" && length >= 9 && buf[at + 16] === 1) {
      // pixels per metre
      return [buf.readUInt32BE(at + 8) * 0.0254, buf.readUInt32BE(at + 12) * 0.0254];
    }
    if (type === "IDAT" || type === "IEND") return null;
    at += 12 + length;
  }
  return null;
}

function jpegDpi(buf: Buffer): [number, number] | null {
  // APP0 JFIF right after SOI: units 1 = dots per inch, 2 = per centimetre.
  if (buf.length < 18 || buf.readUInt16BE(2) !== 0xffe0 || buf.toString("latin1", 6, 10) !== "JFIF") return null;
  const units = buf[13];
  const x = buf.readUInt16BE(14);
  const y = buf.readUInt16BE(16);
  if (!x || !y || (units !== 1 && units !== 2)) return null;
  return units === 1 ? [x, y] : [x * 2.54, y * 2.54];
}
