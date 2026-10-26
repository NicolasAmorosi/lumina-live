import { readBinaryPictures, type BinaryDeckLayer } from "./ppt-binary";

/**
 * A native deck's slide, as `deck_slides.layers` stores it: the pictures of
 * the source that make it up, bottom to top, in the slide's own units — and
 * nothing rasterized anywhere. `worship://deck/<id>/<n>` builds the image from
 * this on every request (`renderNativeSlide`), straight out of the source.
 */
export type SlideLayers = { width: number; height: number; layers: BinaryDeckLayer[] };

export function encodeSlideLayers(slide: SlideLayers): string {
  return JSON.stringify(slide);
}

function decodeSlideLayers(text: string): SlideLayers | null {
  try {
    const value = JSON.parse(text) as Partial<SlideLayers>;
    if (
      typeof value.width !== "number" ||
      typeof value.height !== "number" ||
      !Array.isArray(value.layers) ||
      value.layers.length === 0
    ) {
      return null;
    }
    return value as SlideLayers;
  } catch {
    return null;
  }
}

/** Pixel size of a JPEG (its first SOF marker) or a PNG (its IHDR). */
export function imagePixelSize(bytes: Buffer, type: "jpeg" | "png"): { width: number; height: number } | null {
  if (type === "png") {
    return bytes.length >= 24 && bytes.readUInt32BE(0) === 0x89504e47
      ? { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
      : null;
  }
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let at = 2;
  while (at + 9 < bytes.length) {
    if (bytes[at] !== 0xff) return null;
    const marker = bytes[at + 1]!;
    if (marker === 0xff) {
      at += 1; // fill byte
      continue;
    }
    // SOF0–SOF15, minus DHT (C4), JPG (C8) and DAC (CC), which share the range.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: bytes.readUInt16BE(at + 5), width: bytes.readUInt16BE(at + 7) };
    }
    at += marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) ? 2 : 2 + bytes.readUInt16BE(at + 2);
  }
  return null;
}

/** How far a picture's own proportions may be from the slide's before serving
 *  it as is would visibly change its shape. PowerPoint stretches a picture to
 *  its frame; `<img object-contain>` keeps the picture's own proportions. */
const ASPECT_TOLERANCE = 0.005;

/**
 * The image a native slide is, read from its source right now, or its
 * thumbnail.
 *
 * Four slides out of five in the hymnal are one picture laid edge to edge in
 * its own proportions: those are the JPEG itself, byte for byte. The rest —
 * the first and last slide, with the church's logo over the lyrics — are an
 * SVG placing each picture where PowerPoint does. The pictures go in as
 * `data:` URIs because an SVG used as an image may not fetch anything.
 *
 * `null` when the source no longer gives those bytes; the caller already
 * checked it is the same file the layers were read from.
 */
export function renderNativeSlide(
  sourcePath: string,
  layersJson: string,
  variant: "full" | "thumb",
): { body: Buffer; contentType: string } | null {
  const slide = decodeSlideLayers(layersJson);
  if (!slide) return null;

  // A thumbnail is the base picture alone, as it is in the file: what a tile
  // needs to recognize the hymn. Composing the SVG for it meant parsing ~800 KB
  // of base64 per tile of a library grid, for a logo nobody can see at that
  // size — and resizing it would be a copy, made on the main thread.
  if (variant === "thumb") {
    const [base] = readBinaryPictures(sourcePath, slide.layers.slice(0, 1)) ?? [];
    const type = slide.layers[0]!.type;
    return base ? { body: base, contentType: type === "png" ? "image/png" : "image/jpeg" } : null;
  }

  const pictures = readBinaryPictures(sourcePath, slide.layers);
  if (!pictures) return null;

  const base = slide.layers[0]!;
  const baseBytes = pictures[0]!;
  const baseSize = imagePixelSize(baseBytes, base.type);
  const slideAspect = slide.width / slide.height;

  const edgeToEdge = base.x === 0 && base.y === 0 && base.width === slide.width && base.height === slide.height;
  if (
    slide.layers.length === 1 &&
    edgeToEdge &&
    baseSize &&
    Math.abs(baseSize.width / baseSize.height - slideAspect) / slideAspect <= ASPECT_TOLERANCE
  ) {
    return { body: baseBytes, contentType: base.type === "png" ? "image/png" : "image/jpeg" };
  }

  // The intrinsic size only fixes the proportions the `<img>` lays out with;
  // an SVG is drawn at whatever size it is shown. Taken from the base picture's
  // own resolution so it reads the same as the slides served as is.
  const pixelWidth = baseSize ? Math.round((baseSize.width * slide.width) / base.width) : Math.round(slide.width / 6);
  const pixelHeight = Math.round((pixelWidth * slide.height) / slide.width);
  const images = slide.layers
    .map((layer, i) => {
      const mime = layer.type === "png" ? "image/png" : "image/jpeg";
      return (
        `<image x="${layer.x}" y="${layer.y}" width="${layer.width}" height="${layer.height}" ` +
        `preserveAspectRatio="none" href="data:${mime};base64,${pictures[i]!.toString("base64")}"/>`
      );
    })
    .join("");
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${pixelWidth}" height="${pixelHeight}" ` +
    `viewBox="0 0 ${slide.width} ${slide.height}" preserveAspectRatio="none">${images}</svg>`;
  return { body: Buffer.from(svg), contentType: "image/svg+xml" };
}
