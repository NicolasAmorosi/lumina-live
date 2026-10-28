import type { XmlElement } from "./xml";
import { attr, numAttr } from "./xml";

/**
 * DrawingML colours: a base (`srgbClr`, `schemeClr`, …) and a list of
 * transforms applied in order. The transforms follow what LibreOffice's
 * `oox/source/drawingml/color.cxx` does, which matches PowerPoint: `tint` and
 * `shade` mix in LINEAR RGB (gamma 2.3), `lumMod`/`lumOff`/`sat*`/`hue*` work
 * in HSL. A naive sRGB `lumMod` is visibly off on every themed fill.
 */

/** What a `schemeClr` resolves against: the theme's scheme through the
 *  master's colour map, plus `phClr`, the colour a style reference supplies. */
export type ColorContext = {
  scheme: Record<string, string>;
  map: Record<string, string>;
  placeholder?: Rgba | null;
};

export type Rgba = { r: number; g: number; b: number; a: number };

const BASES = new Set(["a:srgbClr", "a:schemeClr", "a:sysClr", "a:prstClr", "a:scrgbClr", "a:hslClr"]);

/** The colour element among `el`'s children, resolved. */
export function colorIn(el: XmlElement | null | undefined, ctx: ColorContext): Rgba | null {
  if (!el) return null;
  for (const c of el.children) if (BASES.has(c.name)) return resolveColor(c, ctx);
  return null;
}

/** A scheme colour by name (`tx1`, `accent2`), through the colour map. */
export function schemeColor(name: string, ctx: ColorContext): Rgba | null {
  return hex(ctx.scheme[ctx.map[name] ?? name] ?? ctx.scheme[name] ?? null);
}

export function resolveColor(el: XmlElement, ctx: ColorContext): Rgba | null {
  const base = baseColor(el, ctx);
  if (!base) return null;
  return applyTransforms(base, el.children);
}

function baseColor(el: XmlElement, ctx: ColorContext): Rgba | null {
  switch (el.name) {
    case "a:srgbClr":
      return hex(attr(el, "val"));
    case "a:sysClr":
      return systemColor(el);
    case "a:scrgbClr":
      return {
        r: fromLinear(numAttr(el, "r", 0) / 100000),
        g: fromLinear(numAttr(el, "g", 0) / 100000),
        b: fromLinear(numAttr(el, "b", 0) / 100000),
        a: 1,
      };
    case "a:hslClr":
      return fromHsl(numAttr(el, "hue", 0) / 60000, numAttr(el, "sat", 0) / 100000, numAttr(el, "lum", 0) / 100000);
    case "a:prstClr":
      return hex(PRESET[attr(el, "val") ?? ""] ?? null);
    case "a:schemeClr": {
      const name = attr(el, "val") ?? "";
      if (name === "phClr") return ctx.placeholder ? { ...ctx.placeholder } : null;
      const mapped = ctx.map[name] ?? name;
      return hex(ctx.scheme[mapped] ?? ctx.scheme[name] ?? null);
    }
    default:
      return null;
  }
}

function applyTransforms(start: Rgba, transforms: XmlElement[]): Rgba {
  let c = { ...start };
  for (const t of transforms) {
    const v = numAttr(t, "val", 0) / 100000;
    switch (t.name) {
      case "a:alpha":
        c.a = v;
        break;
      case "a:alphaMod":
        c.a *= v;
        break;
      case "a:alphaOff":
        c.a += v;
        break;
      case "a:tint":
        c = mapLinear(c, (x) => 1 - (1 - x) * v);
        break;
      case "a:shade":
        c = mapLinear(c, (x) => x * v);
        break;
      case "a:lumMod":
        c = mapHsl(c, (h, s, l) => [h, s, l * v]);
        break;
      case "a:lumOff":
        c = mapHsl(c, (h, s, l) => [h, s, l + v]);
        break;
      case "a:lum":
        c = mapHsl(c, (h, s) => [h, s, v]);
        break;
      case "a:satMod":
        c = mapHsl(c, (h, s, l) => [h, s * v, l]);
        break;
      case "a:satOff":
        c = mapHsl(c, (h, s, l) => [h, s + v, l]);
        break;
      case "a:sat":
        c = mapHsl(c, (h, _s, l) => [h, v, l]);
        break;
      case "a:hueMod":
        c = mapHsl(c, (h, s, l) => [(h * v) % 360, s, l]);
        break;
      case "a:hueOff":
        c = mapHsl(c, (h, s, l) => [(h + numAttr(t, "val", 0) / 60000) % 360, s, l]);
        break;
      case "a:hue":
        c = mapHsl(c, (_h, s, l) => [numAttr(t, "val", 0) / 60000, s, l]);
        break;
      case "a:comp":
        c = mapHsl(c, (h, s, l) => [(h + 180) % 360, s, l]);
        break;
      case "a:inv":
        c = { r: 1 - c.r, g: 1 - c.g, b: 1 - c.b, a: c.a };
        break;
      case "a:gray": {
        const y = 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
        c = { r: y, g: y, b: y, a: c.a };
        break;
      }
      case "a:gamma":
        c = { r: fromLinear(c.r), g: fromLinear(c.g), b: fromLinear(c.b), a: c.a };
        break;
      case "a:invGamma":
        c = { r: toLinear(c.r), g: toLinear(c.g), b: toLinear(c.b), a: c.a };
        break;
      case "a:red":
      case "a:green":
      case "a:blue":
      case "a:redMod":
      case "a:greenMod":
      case "a:blueMod":
      case "a:redOff":
      case "a:greenOff":
      case "a:blueOff":
        c = channel(c, t.name.slice(2), v);
        break;
      default:
        break;
    }
    c = clamp(c);
  }
  return c;
}

function channel(c: Rgba, op: string, v: number): Rgba {
  const key = op.startsWith("red") ? "r" : op.startsWith("green") ? "g" : "b";
  const lin = { r: toLinear(c.r), g: toLinear(c.g), b: toLinear(c.b) };
  if (op.endsWith("Mod")) lin[key] *= v;
  else if (op.endsWith("Off")) lin[key] += v;
  else lin[key] = v;
  return { r: fromLinear(clamp01(lin.r)), g: fromLinear(clamp01(lin.g)), b: fromLinear(clamp01(lin.b)), a: c.a };
}

const GAMMA = 2.3;
const toLinear = (x: number): number => Math.pow(clamp01(x), GAMMA);
const fromLinear = (x: number): number => Math.pow(clamp01(x), 1 / GAMMA);
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const clamp = (c: Rgba): Rgba => ({ r: clamp01(c.r), g: clamp01(c.g), b: clamp01(c.b), a: clamp01(c.a) });

function mapLinear(c: Rgba, f: (x: number) => number): Rgba {
  return { r: fromLinear(f(toLinear(c.r))), g: fromLinear(f(toLinear(c.g))), b: fromLinear(f(toLinear(c.b))), a: c.a };
}

function mapHsl(c: Rgba, f: (h: number, s: number, l: number) => [number, number, number]): Rgba {
  const [h, s, l] = toHsl(c);
  const [h2, s2, l2] = f(h, s, l);
  return { ...fromHsl(((h2 % 360) + 360) % 360, clamp01(s2), clamp01(l2)), a: c.a };
}

export function toHsl({ r, g, b }: Rgba): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

function fromHsl(h: number, s: number, l: number): Rgba {
  if (s === 0) return { r: l, g: l, b: l, a: 1 };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const k = h / 360;
  const hue = (t: number): number => {
    const x = ((t % 1) + 1) % 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return { r: hue(k + 1 / 3), g: hue(k), b: hue(k - 1 / 3), a: 1 };
}

function hex(value: string | null): Rgba | null {
  if (!value || !/^[0-9a-fA-F]{6}$/.test(value)) return null;
  const n = parseInt(value, 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255, a: 1 };
}

export function css(c: Rgba): string {
  const to255 = (x: number): number => Math.round(clamp01(x) * 255);
  const a = Math.round(clamp01(c.a) * 1000) / 1000;
  return a === 1 ? `rgb(${to255(c.r)},${to255(c.g)},${to255(c.b)})` : `rgba(${to255(c.r)},${to255(c.g)},${to255(c.b)},${a})`;
}

/**
 * A system colour is the colour of THIS machine's UI element, not `lastClr`
 * — that is the colour it had where the deck was last saved. A theme whose
 * lt1 is `window` with `lastClr="C0DCC0"` (a green Windows scheme) paints
 * white in PowerPoint (measured). The defaults below are a standard Windows /
 * macOS light scheme; `lastClr` only for a name not listed.
 */
export function systemColor(el: XmlElement): Rgba | null {
  return SYSTEM[attr(el, "val") ?? ""] ?? hex(attr(el, "lastClr"));
}

const SYSTEM: Record<string, Rgba> = {
  windowText: { r: 0, g: 0, b: 0, a: 1 },
  window: { r: 1, g: 1, b: 1, a: 1 },
  btnFace: { r: 240 / 255, g: 240 / 255, b: 240 / 255, a: 1 },
  btnText: { r: 0, g: 0, b: 0, a: 1 },
  highlight: { r: 0, g: 120 / 255, b: 215 / 255, a: 1 },
  highlightText: { r: 1, g: 1, b: 1, a: 1 },
  grayText: { r: 109 / 255, g: 109 / 255, b: 109 / 255, a: 1 },
  menu: { r: 1, g: 1, b: 1, a: 1 },
  menuText: { r: 0, g: 0, b: 0, a: 1 },
  infoBk: { r: 1, g: 1, b: 225 / 255, a: 1 },
  infoText: { r: 0, g: 0, b: 0, a: 1 },
  captionText: { r: 0, g: 0, b: 0, a: 1 },
  btnShadow: { r: 160 / 255, g: 160 / 255, b: 160 / 255, a: 1 },
  btnHighlight: { r: 1, g: 1, b: 1, a: 1 },
  "3dDkShadow": { r: 105 / 255, g: 105 / 255, b: 105 / 255, a: 1 },
  "3dLight": { r: 227 / 255, g: 227 / 255, b: 227 / 255, a: 1 },
};

/** ECMA-376 §20.1.10.47 `ST_PresetColorVal`: the CSS named colours, spelled
 *  with `dk`/`lt`/`med` prefixes. */
const PRESET: Record<string, string> = Object.fromEntries(
  Object.entries({
    aliceBlue: "F0F8FF", antiqueWhite: "FAEBD7", aqua: "00FFFF", aquamarine: "7FFFD4", azure: "F0FFFF", beige: "F5F5DC",
    bisque: "FFE4C4", black: "000000", blanchedAlmond: "FFEBCD", blue: "0000FF", blueViolet: "8A2BE2", brown: "A52A2A",
    burlyWood: "DEB887", cadetBlue: "5F9EA0", chartreuse: "7FFF00", chocolate: "D2691E", coral: "FF7F50",
    cornflowerBlue: "6495ED", cornsilk: "FFF8DC", crimson: "DC143C", cyan: "00FFFF", darkBlue: "00008B", darkCyan: "008B8B",
    darkGoldenrod: "B8860B", darkGray: "A9A9A9", darkGrey: "A9A9A9", darkGreen: "006400", darkKhaki: "BDB76B",
    darkMagenta: "8B008B", darkOliveGreen: "556B2F", darkOrange: "FF8C00", darkOrchid: "9932CC", darkRed: "8B0000",
    darkSalmon: "E9967A", darkSeaGreen: "8FBC8F", darkSlateBlue: "483D8B", darkSlateGray: "2F4F4F", darkSlateGrey: "2F4F4F",
    darkTurquoise: "00CED1", darkViolet: "9400D3", deepPink: "FF1493", deepSkyBlue: "00BFFF", dimGray: "696969",
    dimGrey: "696969", dodgerBlue: "1E90FF", firebrick: "B22222", floralWhite: "FFFAF0", forestGreen: "228B22",
    fuchsia: "FF00FF", gainsboro: "DCDCDC", ghostWhite: "F8F8FF", gold: "FFD700", goldenrod: "DAA520", gray: "808080",
    grey: "808080", green: "008000", greenYellow: "ADFF2F", honeydew: "F0FFF0", hotPink: "FF69B4", indianRed: "CD5C5C",
    indigo: "4B0082", ivory: "FFFFF0", khaki: "F0E68C", lavender: "E6E6FA", lavenderBlush: "FFF0F5", lawnGreen: "7CFC00",
    lemonChiffon: "FFFACD", lightBlue: "ADD8E6", lightCoral: "F08080", lightCyan: "E0FFFF", lightGoldenrodYellow: "FAFAD2",
    lightGray: "D3D3D3", lightGrey: "D3D3D3", lightGreen: "90EE90", lightPink: "FFB6C1", lightSalmon: "FFA07A",
    lightSeaGreen: "20B2AA", lightSkyBlue: "87CEFA", lightSlateGray: "778899", lightSlateGrey: "778899",
    lightSteelBlue: "B0C4DE", lightYellow: "FFFFE0", lime: "00FF00", limeGreen: "32CD32", linen: "FAF0E6", magenta: "FF00FF",
    maroon: "800000", mediumAquamarine: "66CDAA", mediumBlue: "0000CD", mediumOrchid: "BA55D3", mediumPurple: "9370DB",
    mediumSeaGreen: "3CB371", mediumSlateBlue: "7B68EE", mediumSpringGreen: "00FA9A", mediumTurquoise: "48D1CC",
    mediumVioletRed: "C71585", midnightBlue: "191970", mintCream: "F5FFFA", mistyRose: "FFE4E1", moccasin: "FFE4B5",
    navajoWhite: "FFDEAD", navy: "000080", oldLace: "FDF5E6", olive: "808000", oliveDrab: "6B8E23", orange: "FFA500",
    orangeRed: "FF4500", orchid: "DA70D6", paleGoldenrod: "EEE8AA", paleGreen: "98FB98", paleTurquoise: "AFEEEE",
    paleVioletRed: "DB7093", papayaWhip: "FFEFD5", peachPuff: "FFDAB9", peru: "CD853F", pink: "FFC0CB", plum: "DDA0DD",
    powderBlue: "B0E0E6", purple: "800080", red: "FF0000", rosyBrown: "BC8F8F", royalBlue: "4169E1", saddleBrown: "8B4513",
    salmon: "FA8072", sandyBrown: "F4A460", seaGreen: "2E8B57", seaShell: "FFF5EE", sienna: "A0522D", silver: "C0C0C0",
    skyBlue: "87CEEB", slateBlue: "6A5ACD", slateGray: "708090", slateGrey: "708090", snow: "FFFAFA", springGreen: "00FF7F",
    steelBlue: "4682B4", tan: "D2B48C", teal: "008080", thistle: "D8BFD8", tomato: "FF6347", turquoise: "40E0D0",
    violet: "EE82EE", wheat: "F5DEB3", white: "FFFFFF", whiteSmoke: "F5F5F5", yellow: "FFFF00", yellowGreen: "9ACD32",
  }).flatMap(([name, value]) => {
    const short = name.replace(/^dark/, "dk").replace(/^light/, "lt").replace(/^medium/, "med");
    return short === name ? [[name, value]] : [[name, value], [short, value]];
  }),
);
