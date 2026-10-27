import type {
  ChartAxis,
  ChartBox,
  ChartDataLabel,
  ChartFont,
  ChartLayout,
  ChartMarker,
  ChartModel,
  ChartPlot,
  ChartSeries,
  ChartText,
  ChartTitle,
} from "@shared/types/slide-chart";
import type { Effects, Fill, Line } from "@shared/types/slide-model";
import { useId, type ReactNode } from "react";
import { strokeProps, svgPaint, type PaintContext, type ResolvePart } from "./slide-paint";

type Chart = Extract<ChartModel, { kind: "chart" }>;
type Rect = { x: number; y: number; w: number; h: number };

const PT = 12700;

/**
 * A chart in its box (`w × h`, EMU of the slide), laid out the way Office
 * lays it out — title, legend, axis labels and plot area sized from the text
 * they hold — and drawn as one SVG in EMU. Text is measured with the advance
 * widths of the faces charts are written in (Calibri and Arial, through their
 * metric twins), so the layout needs no fonts loaded and no second pass.
 * Picture fills are drawn when `resolve` is given (parts → URLs), else left out.
 */
export function SlideChart({
  chart,
  w,
  h,
  resolve,
}: {
  chart: ChartModel;
  w: number;
  h: number;
  slideWidth: number;
  resolve?: ResolvePart;
}): ReactNode {
  const id = useId().replace(/:/g, "");
  if (chart.kind === "unsupported" || w <= 0 || h <= 0) return null;
  const layout = layoutChart(chart, w, h);
  const out: ReactNode[] = [];
  const defs: ReactNode[] = [];
  let n = 0;
  const key = (): string => `${id}-${n++}`;
  const paint = paintWith(defs, key, resolve ?? null);

  out.push(paint.box(chart.space, { x: 0, y: 0, w, h }));
  if (layout.plot) out.push(paint.box(chart.plotArea, layout.plot.inner));
  if (layout.plot) out.push(...drawAxesBehind(layout.plot, key));
  for (const p of chart.plots) out.push(drawPlot(p, layout, paint));
  if (layout.plot) out.push(...drawAxesFront(layout.plot, key));
  out.push(...drawDataLabels(chart, layout, paint, key));
  if (layout.legend) out.push(drawLegend(chart, layout.legend, paint, key));
  if (layout.title) out.push(drawText(layout.title.block, layout.title, 0, key()));
  for (const t of layout.axisTitles) out.push(drawText(t.title.text, t.rect, t.rotation, key()));

  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" width="100%" height="100%" style={{ position: "absolute", inset: 0, overflow: "visible" }}>
      <defs>{defs}</defs>
      {out}
    </svg>
  );
}

// ── Text ────────────────────────────────────────────────────────────────────

/** Advance widths (‰ of the em) of U+0020..U+007E: Carlito and Liberation
 *  Sans, metric twins of Calibri and Arial. */
const WIDTHS: Record<"calibri" | "calibriBold" | "arial" | "arialBold", number[]> = {
  calibri: [226,326,401,498,507,715,682,221,303,303,498,498,250,306,252,386,507,507,507,507,507,507,507,507,507,507,268,268,498,498,498,463,894,579,544,533,615,488,459,631,623,252,319,520,420,855,646,662,517,673,543,459,487,642,567,890,519,487,468,307,386,307,498,498,291,479,525,423,525,498,305,471,525,229,239,455,229,799,525,527,525,525,349,391,335,525,452,715,433,453,395,314,460,314,498],
  calibriBold: [226,326,438,498,507,729,705,233,312,312,498,498,258,306,267,430,507,507,507,507,507,507,507,507,507,507,276,276,498,498,498,463,898,606,561,529,630,488,459,637,631,267,331,547,423,874,659,676,532,686,563,473,495,653,591,906,551,520,478,325,430,325,498,498,300,494,537,418,537,503,316,474,537,246,255,480,246,813,537,538,537,537,355,399,347,537,473,745,459,474,397,344,475,344,498],
  arial: [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584],
  arialBold: [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584],
};

/** Calibri-like faces measure as Calibri; everything else as Arial. */
const isCalibri = (face: string): boolean => /calibri|carlito|candara|corbel|segoe/i.test(face);

/** Ascent and descent (em) of the face's line. */
const metrics = (font: ChartFont): [number, number] => (isCalibri(font.face) ? [0.952, 0.269] : [0.905, 0.212]);

/** Faces measured from tables: Calibri and Arial and their metric twins
 *  (loaded as web fonts, so not measurable until they load). */
const tabled = (face: string): boolean => isCalibri(face) || /^(arial|liberation sans|arimo|helvetica)$/i.test(face);

let canvas: CanvasRenderingContext2D | null | undefined;
const measures = new Map<string, number | null>();

/** Any other face is a system font, there at once: the browser measures it.
 *  `null` when it isn't installed (it measures as the fallback). */
function measureFace(text: string, font: ChartFont): number | null {
  const key = `${font.face}|${font.bold}|${font.italic}|${text}`;
  const known = measures.get(key);
  if (known !== undefined) return known;
  if (canvas === undefined) canvas = typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d");
  let out: number | null = null;
  if (canvas) {
    const style = `${font.italic ? "italic " : ""}${font.bold ? 700 : 400} 100px`;
    canvas.font = `${style} "${font.face.replace(/"/g, "")}", monospace`;
    const own = canvas.measureText(text).width;
    canvas.font = `${style} monospace`;
    if (own !== canvas.measureText(text).width) out = own / 100;
  }
  if (measures.size > 5000) measures.clear();
  measures.set(key, out);
  return out;
}

function textWidth(text: string, font: ChartFont): number {
  const measured = tabled(font.face) ? null : measureFace(text, font);
  if (measured !== null) return measured * font.size * PT;
  const table = WIDTHS[`${isCalibri(font.face) ? "calibri" : "arial"}${font.bold ? "Bold" : ""}`];
  let units = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 32;
    units += c >= 32 && c < 127 ? (table[c - 32] ?? 500) : c >= 0x2e80 ? 1000 : 520;
  }
  return (units / 1000) * font.size * PT;
}

const lineHeight = (font: ChartFont): number => (metrics(font)[0] + metrics(font)[1]) * font.size * PT;

const TWINS: Record<string, string> = {
  calibri: "Carlito",
  "calibri light": "Carlito",
  cambria: "Caladea",
  arial: "Liberation Sans",
  "times new roman": "Liberation Serif",
  "courier new": "Liberation Mono",
};

function cssFamily(face: string): string {
  const twin = TWINS[face.toLowerCase()];
  return [face, ...(twin ? [twin] : []), isCalibri(face) ? "Carlito" : "Liberation Sans"].map((f) => `"${f.replace(/"/g, "")}"`).join(", ") + ", sans-serif";
}

/** A block of text: lines (paragraphs, or a label broken to fit), each a
 *  list of runs. */
type Block = { lines: { align: "l" | "ctr" | "r"; runs: { text: string; font: ChartFont }[] }[]; w: number; h: number };

/** Rich text as lines, each paragraph broken at spaces to `maxWidth`. */
function block(text: ChartText, maxWidth = Infinity): Block {
  const lines: Block["lines"] = [];
  for (const p of text) {
    let line: Block["lines"][number]["runs"] = [];
    let width = 0;
    for (const r of p.runs) {
      for (const word of r.text.split(/(?<= )/)) {
        const w = textWidth(word, r.font);
        if (line.length && width + textWidth(word.trimEnd(), r.font) > maxWidth) {
          lines.push({ align: p.align, runs: trimLine(line) });
          line = [];
          width = 0;
        }
        const last = line[line.length - 1];
        if (last && last.font === r.font) last.text += word;
        else line.push({ text: word, font: r.font });
        width += w;
      }
    }
    lines.push({ align: p.align, runs: line.length ? trimLine(line) : p.runs });
  }
  return measured(lines);
}

function trimLine(runs: Block["lines"][number]["runs"]): Block["lines"][number]["runs"] {
  const last = runs[runs.length - 1];
  return last ? [...runs.slice(0, -1), { ...last, text: last.text.trimEnd() }] : runs;
}

/** Office breaks a title to 80% of the chart's width. */
const TITLE_WIDTH = 0.8;

function measured(lines: Block["lines"]): Block {
  let w = 0;
  let h = 0;
  for (const l of lines) {
    w = Math.max(w, l.runs.reduce((s, r) => s + textWidth(r.text, r.font), 0));
    h += Math.max(...l.runs.map((r) => lineHeight(r.font)), 0);
  }
  return { lines, w, h };
}

function plainBlock(text: string, font: ChartFont, maxWidth = Infinity, align: "l" | "ctr" | "r" = "ctr"): Block {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    if (textWidth(para, font) <= maxWidth) {
      out.push(para);
      continue;
    }
    let line = "";
    for (const word of para.split(" ")) {
      const next = line ? `${line} ${word}` : word;
      if (line && textWidth(next, font) > maxWidth) {
        out.push(line);
        line = word;
      } else line = next;
    }
    out.push(line);
  }
  return measured(out.map((t) => ({ align, runs: [{ text: t, font }] })));
}

/** A block drawn in `rect`, rotated about its centre by `rotation` degrees. */
function drawText(text: ChartText | Block, rect: Rect, rotation: number, k: string): ReactNode {
  const b = Array.isArray(text) ? block(text) : text;
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  let y = cy - b.h / 2;
  return (
    <g key={k} transform={rotation ? `rotate(${rotation} ${cx} ${cy})` : undefined}>
      {b.lines.map((l, i) => {
        const font = l.runs[0]?.font;
        if (!font) return null;
        const lh = Math.max(...l.runs.map((r) => lineHeight(r.font)));
        const base = y + metrics(font)[0] * Math.max(...l.runs.map((r) => r.font.size)) * PT;
        y += lh;
        const lw = l.runs.reduce((s, r) => s + textWidth(r.text, r.font), 0);
        const x = l.align === "l" ? cx - b.w / 2 : l.align === "r" ? cx + b.w / 2 - lw : cx - lw / 2;
        return svgText(l.runs, x, base, "start", null, String(i));
      })}
    </g>
  );
}

/**
 * Text at a baseline point (EMU). Drawn in POINTS inside a `scale(PT)`:
 * Chromium clamps a font size of a few hundred thousand user units, so EMU
 * sizes come out a pixel tall.
 */
function svgText(
  runs: { text: string; font: ChartFont }[],
  x: number,
  y: number,
  anchor: "start" | "middle" | "end",
  rotate: [number, number, number] | null,
  k: string,
): ReactNode {
  const transform = `${rotate ? `rotate(${rotate[0]} ${rotate[1]} ${rotate[2]}) ` : ""}scale(${PT})`;
  return (
    <text key={k} x={x / PT} y={y / PT} textAnchor={anchor} transform={transform} style={{ whiteSpace: "pre" }}>
      {runs.map((r, j) => (
        <tspan key={j} {...fontProps(r.font)}>
          {r.text}
        </tspan>
      ))}
    </text>
  );
}

function fontProps(font: ChartFont): Record<string, string | number> {
  return {
    fontFamily: cssFamily(font.face),
    fontSize: font.size,
    fontWeight: font.bold ? 700 : 400,
    fontStyle: font.italic ? "italic" : "normal",
    textDecoration: font.underline ? "underline" : "none",
    fill: font.color,
  };
}

/** One line of plain text with its baseline placed for a box whose top is `top`. */
function label(text: string, font: ChartFont, x: number, top: number, anchor: "start" | "middle" | "end", k: string): ReactNode {
  return svgText([{ text, font }], x, top + metrics(font)[0] * font.size * PT, anchor, null, k);
}

// ── Number formats ──────────────────────────────────────────────────────────

/** The separators of the user's locale: PowerPoint writes numbers with the
 *  system's, whatever language the file was made in. */
const SEPARATORS = (() => {
  const parts = new Intl.NumberFormat().formatToParts(12345.6);
  return { decimal: parts.find((p) => p.type === "decimal")?.value ?? ".", group: parts.find((p) => p.type === "group")?.value ?? "," };
})();

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** A cached value through an Excel number format: the common subset —
 *  General, digits, grouping, decimals, percent, scaling commas, literals,
 *  sections, and dates. */
function formatValue(value: number | string | null, code: string, date1904 = false): string {
  if (value === null) return "";
  if (typeof value === "string") return value;
  const sections = splitSections(code);
  let section = sections[0] ?? "General";
  let v = value;
  if (v < 0 && sections.length > 1) {
    section = sections[1]!;
    v = -v;
  } else if (v === 0 && sections.length > 2) section = sections[2]!;
  // Colours, conditions and locale tags; a currency tag keeps its symbol.
  section = section.replace(/\[\$([^\]-]*)(-[^\]]*)?\]/g, (_m, sym: string) => (sym ? `"${sym}"` : "")).replace(/\[[^\]]*\]/g, "");
  if (/^\s*general\s*$/i.test(section) || section.trim() === "") return (v < 0 ? "-" : "") + general(Math.abs(v));
  const bare = section.replace(/"[^"]*"|\\.|_.|\*./g, "");
  if (/^m\/d\/yy(yy)?$/i.test(section.trim())) return shortDate(v, date1904);
  if (/[dmyhs]/i.test(bare.replace(/E[+-]/gi, ""))) return formatDate(v, section, date1904);
  return formatNumber(v, section, sections.length > 1 && value < 0);
}

function splitSections(code: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < code.length; i++) {
    const c = code[i]!;
    if (c === '"') quoted = !quoted;
    if (c === "\\" && !quoted) {
      cur += c + (code[i + 1] ?? "");
      i++;
      continue;
    }
    if (c === ";" && !quoted) {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

function general(v: number): string {
  if (v === 0) return "0";
  if (v >= 1e11 || v < 1e-9) return v.toExponential(5).replace(/\.?0+e/, "E").replace(".", SEPARATORS.decimal);
  const digits = Math.max(0, 10 - Math.max(0, Math.floor(Math.log10(v)) + 1));
  const s = v.toFixed(Math.min(digits, 10)).replace(/\.?0+$/, "");
  return s.replace(".", SEPARATORS.decimal);
}

function formatNumber(value: number, section: string, signDone: boolean): string {
  // Literal pieces vs the number's own placeholders.
  let num = "";
  let numDone = false;
  const pieces: ({ lit: string } | { num: true })[] = [];
  let lit = "";
  const flushLit = (): void => {
    if (lit) pieces.push({ lit });
    lit = "";
  };
  for (let i = 0; i < section.length; i++) {
    const c = section[i]!;
    if (c === '"') {
      const end = section.indexOf('"', i + 1);
      lit += section.slice(i + 1, end < 0 ? undefined : end);
      i = end < 0 ? section.length : end;
    } else if (c === "\\") {
      lit += section[i + 1] ?? "";
      i++;
    } else if (c === "_") {
      lit += " ";
      i++;
    } else if (c === "*") i++;
    else if (!numDone && /[0#?.,]/.test(c) && (/[0#?]/.test(c) || num !== "" || /[0#?]/.test(section[i + 1] ?? ""))) {
      if (num === "") {
        flushLit();
        pieces.push({ num: true });
      }
      num += c;
      if (/[eE]/.test(section[i + 1] ?? "")) numDone = true;
    } else if ((c === "E" || c === "e") && num !== "" && /[+-]/.test(section[i + 1] ?? "")) {
      num += section.slice(i, i + 2);
      i++;
      while (/[0#?]/.test(section[i + 1] ?? "")) num += section[++i];
      numDone = true;
    } else {
      if (num !== "") numDone = true;
      lit += c;
    }
  }
  flushLit();

  let v = value;
  const percents = (section.replace(/"[^"]*"|\\./g, "").match(/%/g) ?? []).length;
  v *= Math.pow(100, percents);
  const exp = num.match(/[eE][+-]([0#?]+)$/);
  const mantissa = exp ? num.slice(0, exp.index) : num;
  const trailing = mantissa.match(/,+$/)?.[0].length ?? 0;
  const body = mantissa.slice(0, mantissa.length - trailing);
  v /= Math.pow(1000, trailing);
  const [intPart = "", fracPart = ""] = body.split(".");
  const decimals = (fracPart.match(/[0#?]/g) ?? []).length;
  const minDecimals = (fracPart.match(/0/g) ?? []).length;
  const minInt = (intPart.match(/0/g) ?? []).length;
  const grouped = /[0#?],[0#?]/.test(intPart);

  const neg = v < 0 && !signDone;
  let a = Math.abs(v);
  let expText = "";
  if (exp) {
    const e = a === 0 ? 0 : Math.floor(Math.log10(a));
    a /= Math.pow(10, e);
    expText = `E${e < 0 ? "-" : num.includes("E+") || num.includes("e+") ? "+" : ""}${String(Math.abs(e)).padStart(exp[1]!.length, "0")}`;
  }
  let [i = "0", f = ""] = a.toFixed(decimals).split(".");
  while (f.length > minDecimals && f.endsWith("0")) f = f.slice(0, -1);
  if (i === "0" && minInt === 0) i = "";
  i = i.padStart(minInt, "0");
  if (grouped) i = i.replace(/\B(?=(\d{3})+(?!\d))/g, SEPARATORS.group);
  const text = (f ? `${i}${SEPARATORS.decimal}${f}` : i) + expText;
  return (neg ? "-" : "") + pieces.map((p) => ("lit" in p ? p.lit : text)).join("");
}

function serialDate(serial: number, date1904: boolean): Date {
  const ms = date1904 ? Date.UTC(1904, 0, 1) + serial * 86400000 : Date.UTC(1899, 11, 30) + serial * 86400000;
  return new Date(Math.round(ms / 1000) * 1000);
}

/** `m/d/yy` is Excel's built-in short date (format 14): Office writes it in
 *  the system's short date, not as spelled (`05/01/2002` in en-GB). */
const SHORT_DATE = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "numeric", year: "numeric", timeZone: "UTC" });
const shortDate = (serial: number, date1904: boolean): string => SHORT_DATE.format(serialDate(serial, date1904));

function formatDate(serial: number, section: string, date1904: boolean): string {
  const d = serialDate(serial, date1904);
  const ampm = /AM\/PM|A\/P/i.test(section);
  let out = "";
  let lastWasHour = false;
  for (let i = 0; i < section.length; ) {
    const rest = section.slice(i);
    const c = section[i]!;
    if (c === '"') {
      const end = section.indexOf('"', i + 1);
      out += section.slice(i + 1, end < 0 ? undefined : end);
      i = end < 0 ? section.length : end + 1;
      continue;
    }
    if (c === "\\") {
      out += section[i + 1] ?? "";
      i += 2;
      continue;
    }
    const run = rest.match(/^(y+|m+|d+|h+|s+|AM\/PM|A\/P)/i)?.[0];
    if (!run) {
      out += c === "_" || c === "*" ? "" : c;
      i += c === "_" || c === "*" ? 2 : 1;
      continue;
    }
    const t = run.toLowerCase();
    // `m`/`mm` are minutes right after an hour or right before seconds.
    const minuteContext = lastWasHour || /^m{1,2}[^a-z]*s/i.test(rest);
    if (t[0] === "y") out += t.length <= 2 ? String(d.getUTCFullYear()).slice(-2) : String(d.getUTCFullYear());
    else if (t[0] === "m" && minuteContext && t.length <= 2) out += String(d.getUTCMinutes()).padStart(t.length, "0");
    else if (t[0] === "m") {
      const m = d.getUTCMonth();
      out += t.length === 1 ? String(m + 1) : t.length === 2 ? String(m + 1).padStart(2, "0") : t.length === 3 ? MONTHS[m]!.slice(0, 3) : t.length === 5 ? MONTHS[m]![0]! : MONTHS[m]!;
    } else if (t[0] === "d") {
      out += t.length === 1 ? String(d.getUTCDate()) : t.length === 2 ? String(d.getUTCDate()).padStart(2, "0") : t.length === 3 ? DAYS[d.getUTCDay()]!.slice(0, 3) : DAYS[d.getUTCDay()]!;
    } else if (t[0] === "h") {
      const hr = ampm ? d.getUTCHours() % 12 || 12 : d.getUTCHours();
      out += String(hr).padStart(t.length, "0");
    } else if (t[0] === "s") out += String(d.getUTCSeconds()).padStart(t.length, "0");
    else out += d.getUTCHours() < 12 ? (t.length > 3 ? "AM" : "A") : t.length > 3 ? "PM" : "P";
    lastWasHour = t[0] === "h";
    i += run.length;
  }
  return out;
}

// ── Scales ──────────────────────────────────────────────────────────────────

type Scale = { min: number; max: number; major: number; minor: number };

/**
 * Office's automatic value scale (Microsoft's KB 214075, and measured): zero
 * is the floor unless the data sit in the top sixth of their range; the top
 * gets 5% of the range as headroom; both ends round to the major unit, the
 * finest 1-2-5 step whose labels fit the axis `length` at `room` each, and
 * that makes at most ten majors. A percent stack runs 0..100%.
 */
function valueScale(lo: number, hi: number, axis: ChartAxis, length: number, room: number, percent: boolean): Scale {
  let dmin = Math.min(lo, hi);
  let dmax = Math.max(lo, hi);
  if (!Number.isFinite(dmin) || !Number.isFinite(dmax)) [dmin, dmax] = [0, 1];
  if (percent) [dmin, dmax] = [dmin < 0 ? -1 : 0, dmax > 0 ? 1 : 0];
  if (axis.min !== null) dmin = axis.min;
  if (axis.max !== null) dmax = axis.max;
  if (dmin > dmax) [dmin, dmax] = [dmax, dmin];
  if (dmin === dmax) {
    if (dmax > 0) dmin = 0;
    else if (dmax < 0) dmax = 0;
    else dmax = 1;
  }
  // Which ends float: a fixed bound, a percent stack, or a zero floor stay put.
  const zeroMin = axis.min === null && dmin >= 0 && (dmin === 0 || (dmax - dmin) / dmax > 1 / 6);
  const zeroMax = axis.max === null && dmax <= 0 && (dmax === 0 || (dmax - dmin) / -dmin > 1 / 6);
  const lowEnd = zeroMin ? 0 : dmin;
  const highEnd = zeroMax ? 0 : dmax;
  const range = highEnd - lowEnd || Math.abs(highEnd) || 1;
  const pick = (unit: number): Scale => {
    const min =
      axis.min ?? (percent || zeroMin ? lowEnd : Math.floor((dmin >= 0 ? dmin - (dmax - dmin) / 2 : dmin - 0.05 * range) / unit + 1e-9) * unit);
    const max =
      axis.max ?? (percent || zeroMax ? highEnd : Math.ceil((dmax <= 0 ? dmax + (dmax - dmin) / 2 : dmax + 0.05 * range) / unit - 1e-9) * unit);
    const lo2 = dmin >= 0 && !zeroMin && axis.min === null ? Math.max(0, min) : min;
    return { min: lo2, max: max > lo2 ? max : lo2 + unit, major: unit, minor: axis.minorUnit ?? unit / 5 };
  };
  if (axis.majorUnit) return pick(axis.majorUnit);
  let p = Math.pow(10, Math.floor(Math.log10(range)) - 3);
  for (let k = 0; k < 60; k++, p *= 10) {
    for (const step of [1, 2, 5]) {
      const sc = pick(step * p);
      const intervals = Math.round((sc.max - sc.min) / (step * p));
      if (intervals <= MAX_INTERVALS && (intervals + 1) * room <= length * (1 + 1e-9)) return sc;
    }
  }
  return pick(range);
}

function ticks(s: Scale, step: number): number[] {
  const out: number[] = [];
  if (step <= 0) return out;
  const first = Math.ceil(s.min / step - 1e-9) * step;
  for (let v = first; v <= s.max + step * 1e-9 && out.length < 1000; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return out;
}

// ── Layout ──────────────────────────────────────────────────────────────────

/**
 * Office's spacing, measured on its own rendering (`shp-access-chart`,
 * `pie-chart`, `tdf112089`: 12 and 18 pt text, 2007 and 2013 styles). None of
 * it scales with the text but the legend's.
 */
const PAD = 5.5 * PT; // chart area to anything in it
const TITLE_TOP = 3 * PT; // the margin to the title's text
const TITLE_GAP = 2 * PT; // title text to what is under it
const PLOT_TOP = 10 * PT; // top of the space to the plot's inside, under a value axis's top label
const PLOT_TOP_BARE = 5 * PT; // … with no label reaching up
const PLOT_RIGHT = 6.5 * PT; // the plot's inside to the right end of its space
const VALUE_RIGHT = 14.9 * PT; // … at least, beside a horizontal value axis
const OVERHANG_GAP = 4.4 * PT; // a horizontal value axis's last label to that end
/** An axis whose labels are turned off still keeps this much room: under the
 *  plot (or over it), and beside it. */
const NO_LABELS = { across: 12.1 * PT, beside: 9.9 * PT };
const PIE_BOTTOM = 6 * PT;
/** Tick marks are as long as the axis's text is big: 5.6 pt at 18 pt, about
 *  2.5 pt at 8 pt (`shp-access-chart`, an AASCU deck). */
const tickLength = (axis: ChartAxis): number => 0.31 * axis.font.size * PT;
/** Tick labels from the tick's end: value labels sit farther out. */
const valueGap = (tick: number): number => tick + 11 * PT;
const categoryGap = (tick: number, offset: number): number => (Math.max(8 * PT, tick + 6.1 * PT) * offset) / 100;
const LEGEND_GAP = 10.5 * PT; // legend to the plot's space
const LEGEND_PAD_X = 1.4 * PT;
const LEGEND_PAD_Y = 4.9 * PT;

type AxisLayout = {
  axis: ChartAxis;
  horizontal: boolean;
  /** Value axes: the scale. Category axes: none. */
  scale: Scale | null;
  /** Category count, for category axes. */
  count: number;
  /** Category axes: categories on ticks (`midCat`) instead of between. */
  onTicks: boolean;
  /** `at`: the value (value axes) or category index; `t`: where along the
   *  axis, 0..1 from its start. */
  labels: { text: string; at: number; t: number }[];
  /** Where the ticks are, 0..1. */
  tickTs: number[];
  /** Where category `i` (or, on a value axis, value `i`) sits, 0..1. */
  slot: (i: number) => number;
  /** Length of one category's band (EMU): what bars divide. */
  band: number;
  /** How tick labels are drawn. */
  rotation: number;
  wrap: number;
  /** Space the labels and ticks take outside the plot (EMU). */
  depth: number;
  /** Multi-level categories: the depth of the labels' own row, and the
   *  groups drawn in rows under it. */
  leafDepth: number;
  groups: { text: string; start: number }[][];
};

type PlotLayout = {
  inner: Rect;
  cat: AxisLayout | null;
  val: AxisLayout | null;
  /** Map a category index (or scatter X) / a value to a coordinate along its axis. */
  catPos: (i: number) => number;
  /** A point 0..1 along the category axis, as a coordinate. */
  catAt: (t: number) => number;
  valPos: (v: number) => number;
  horizontal: boolean;
};

type Layout = {
  title: (Rect & { block: Block }) | null;
  legend: { rect: Rect; entries: LegendEntry[]; columns: number; rowH: number; colW: number; single: boolean } | null;
  plot: PlotLayout | null;
  pie: { cx: number; cy: number; r: number } | null;
  axisTitles: { title: ChartTitle; rect: Rect; rotation: number }[];
  chartW: number;
  chartH: number;
};

type LegendEntry = { text: string; series: ChartSeries; point: number | null; kind: "box" | "line"; plot: ChartPlot };

function legendEntries(chart: Chart, side: boolean): LegendEntry[] {
  const out: LegendEntry[] = [];
  const pie = chart.plots.length === 1 && chart.plots[0]!.kind === "pie";
  const firstSeries = chart.plots[0]?.series[0];
  if (firstSeries && (pie || (chart.plots.length === 1 && chart.plots[0]!.series.length === 1 && firstSeries.points && varied(firstSeries)))) {
    const count = Math.max(firstSeries.values.values.length, chart.categories.values.length);
    for (let i = 0; i < count; i++) {
      out.push({ text: formatValue(chart.categories.values[i] ?? i + 1, chart.categories.format, chart.date1904), series: firstSeries, point: i, kind: "box", plot: chart.plots[0]! });
    }
    return out;
  }
  for (const p of chart.plots) {
    const list = p.series.map((s) => ({ text: s.name, series: s, point: null, kind: p.kind === "line" || p.kind === "scatter" ? ("line" as const) : ("box" as const), plot: p }));
    // A side legend lists horizontal bars and stacks bottom-up, like they are drawn.
    if (side && ((p.kind === "bar" && p.horizontal) || ((p.kind === "bar" || p.kind === "area") && p.grouping.endsWith("tacked")))) list.reverse();
    out.push(...list);
  }
  return out;
}

/** A series whose points are painted differently (varyColors). */
function varied(s: ChartSeries): boolean {
  const pts = s.points;
  if (!pts || pts.length < 2) return false;
  return pts.some((p) => JSON.stringify(p.fill) !== JSON.stringify(pts[0]!.fill));
}

function layoutChart(chart: Chart, W: number, H: number): Layout {
  const out: Layout = { title: null, legend: null, plot: null, pie: null, axisTitles: [], chartW: W, chartH: H };
  let area: Rect = { x: PAD, y: PAD, w: W - 2 * PAD, h: H - 2 * PAD };

  if (chart.title) {
    const b = block(chart.title.text, W * TITLE_WIDTH);
    const lay = chart.title.layout;
    const rect = {
      x: lay?.x !== null && lay?.x !== undefined ? lay.x * W : (W - b.w) / 2,
      y: lay?.y !== null && lay?.y !== undefined ? lay.y * H : PAD + TITLE_TOP,
      w: b.w,
      h: b.h,
    };
    out.title = { ...rect, block: b };
    if (!chart.title.overlay && !lay) {
      const bottom = rect.y + rect.h + TITLE_GAP;
      area = { ...area, y: bottom, h: area.y + area.h - bottom };
    }
  }

  if (chart.legend) {
    const lg = chart.legend;
    const side = lg.pos === "r" || lg.pos === "l" || lg.pos === "tr";
    let entries = legendEntries(chart, side).filter((_, i) => !lg.hidden.includes(i));
    const font = lg.font;
    const em = font.size * PT;
    const rowH = lineHeight(font) + LEGEND_ROW_GAP * em;
    // A side legend shows the entries that fit the chart's height, no more.
    if (side && !lg.layout) entries = entries.slice(0, Math.max(1, Math.floor((area.h - 2 * LEGEND_PAD_Y) / rowH)));
    if (entries.length) {
      const texts = entries.map((e) => textWidth(e.text, font));
      const keyW = keyWidth(entries, font) + keyGap(entries) * em;
      // Side legends stack their entries; top and bottom ones flow them in
      // rows, as many to a row as fit, every column as wide as the widest.
      let columns = 1;
      let colW = keyW + Math.max(...texts);
      if (!side) {
        const each = texts.map((t) => keyW + t + LEGEND_ENTRY_GAP * em);
        const total = each.reduce((x, y) => x + y, 0) - LEGEND_ENTRY_GAP * em;
        if (total <= area.w - 2 * LEGEND_PAD_X) columns = entries.length;
        else {
          colW = Math.max(...each);
          columns = Math.max(1, Math.floor((area.w - 2 * LEGEND_PAD_X + LEGEND_ENTRY_GAP * em) / colW));
        }
      }
      const rows = Math.ceil(entries.length / columns);
      const single = !side && columns === entries.length;
      const contentW = single ? texts.reduce((x, t) => x + keyW + t + LEGEND_ENTRY_GAP * em, 0) - LEGEND_ENTRY_GAP * em : columns * colW;
      let lw = contentW + 2 * LEGEND_PAD_X;
      let lh = rows * (side ? rowH : lineHeight(font)) + 2 * LEGEND_PAD_Y;
      let rect: Rect;
      const lay = lg.layout;
      if (lay && lay.x !== null && lay.y !== null) {
        if (lay.w !== null) lw = lay.w * W;
        if (lay.h !== null) lh = lay.h * H;
        rect = { x: lay.x * W, y: lay.y * H, w: lw, h: lh };
      } else {
        const right = area.x + area.w;
        const bottom = area.y + area.h;
        switch (lg.pos) {
          case "l":
            rect = { x: area.x, y: area.y + (area.h - lh) / 2, w: lw, h: lh };
            if (!lg.overlay) area = { ...area, x: area.x + lw + LEGEND_GAP, w: area.w - lw - LEGEND_GAP };
            break;
          case "t":
            rect = { x: (W - lw) / 2, y: area.y, w: lw, h: lh };
            if (!lg.overlay) area = { ...area, y: area.y + lh, h: area.h - lh };
            break;
          case "b":
            rect = { x: (W - lw) / 2, y: bottom - lh, w: lw, h: lh };
            if (!lg.overlay) area = { ...area, h: area.h - lh };
            break;
          case "tr":
            rect = { x: right - lw, y: area.y, w: lw, h: lh };
            if (!lg.overlay) area = { ...area, w: area.w - lw - LEGEND_GAP };
            break;
          default:
            rect = { x: right - lw, y: area.y + (area.h - lh) / 2, w: lw, h: lh };
            if (!lg.overlay) area = { ...area, w: area.w - lw - LEGEND_GAP };
        }
      }
      out.legend = { rect, entries, columns: single ? entries.length : columns, rowH: side ? rowH : lineHeight(font), colW, single };
    }
  }

  const manual = chart.plotArea.layout;
  if (chart.plots.every((p) => p.kind === "pie")) {
    let r: Rect = { x: area.x, y: area.y + PLOT_TOP, w: area.w, h: area.h - PLOT_TOP - PIE_BOTTOM };
    if (manual && manual.x !== null && manual.y !== null && manual.w !== null && manual.h !== null) {
      r = { x: manual.x * W, y: manual.y * H, w: manual.w * W, h: manual.h * H };
    }
    const plot = chart.plots[0];
    const explode = plot ? Math.max(0, ...plot.series.flatMap((s) => [s.explosion, ...(s.points ?? []).map((p) => p.explosion)])) : 0;
    // Labels shrink the pie, room for them outside (measured on a doughnut:
    // 305 px against 352 px without labels, 18 pt text).
    const label = plot?.series.flatMap((s) => s.labels).find((l) => l !== null);
    const room = label && !manual ? 0.8 * lineHeight(label.font) : 0;
    const radius = (Math.min(r.w, r.h) / 2 - room) / (1 + explode / 100);
    out.pie = { cx: r.x + r.w / 2, cy: r.y + r.h / 2, r: Math.max(0, radius) };
    return out;
  }

  out.plot = layoutPlot(chart, area, manual, W, H, out);
  return out;
}

/** Legend geometry, in ems of the legend's text. */
const LEGEND_ROW_GAP = 0.33;
const LEGEND_ENTRY_GAP = 0.77;
const keySize = (font: ChartFont): number => 0.55 * font.size * PT;
/** With a line among the entries every key is a short stretch of line (a box
 *  as long as it), nearly touching its text. */
const hasLineKey = (entries: LegendEntry[]): boolean => entries.some((e) => e.kind === "line");
const keyWidth = (entries: LegendEntry[], font: ChartFont): number => (hasLineKey(entries) ? 1.1 : 0.55) * font.size * PT;
const keyGap = (entries: LegendEntry[]): number => (hasLineKey(entries) ? 0.12 : 0.39);
/** Legend markers are drawn no bigger than this (points). */
const LEGEND_MARKER = 7;

function layoutPlot(chart: Chart, area: Rect, manual: ChartLayout | null, W: number, H: number, out: Layout): PlotLayout {
  const plots = chart.plots;
  const bar = plots.find((p) => p.kind === "bar");
  const horizontal = bar?.kind === "bar" && bar.horizontal;
  const scatter = plots.some((p) => p.kind === "scatter");
  const catAxis = chart.categoryAxis;
  const valAxis = chart.valueAxis;

  // Values the value axis must hold.
  const [lo, hi] = valueRange(chart);
  const xr = scatter ? xRange(chart) : null;
  const count = Math.max(chart.categories.values.length, ...plots.flatMap((p) => p.series.map((s) => s.values.values.length)), 1);
  const percent = plots.some((p) => (p.kind === "bar" || p.kind === "line" || p.kind === "area") && p.grouping === "percentStacked");
  const onTicks = !scatter && valAxis ? !valAxis.between : false;

  // Axis titles take a band on their side.
  const titleBand = (axis: ChartAxis | null): number => (axis?.title && !axis.deleted ? block(axis.title.text).h + TITLE_GAP : 0);

  let outer: Rect = area;
  if (manual && manual.x !== null && manual.y !== null && manual.w !== null && manual.h !== null) {
    outer = { x: manual.x * W, y: manual.y * H, w: manual.w * W, h: manual.h * H };
  }
  const innerGiven = manual?.inner === true && manual.x !== null && manual.w !== null && manual.y !== null && manual.h !== null;

  const catHorizontal = !horizontal;
  let inner: Rect = { ...outer };
  let cat: AxisLayout | null = null;
  let val: AxisLayout | null = null;
  for (let pass = 0; pass < 3; pass++) {
    cat = catAxis
      ? scatter && xr
        ? valueAxisLayout(catAxis, xr[0], xr[1], catHorizontal ? inner.w : inner.h, catHorizontal, false, firstFormat(chart, true), chart)
        : categoryAxisLayout(catAxis, chart, count, onTicks, catHorizontal ? inner.w : inner.h, catHorizontal)
      : null;
    val = valAxis ? valueAxisLayout(valAxis, lo, hi, catHorizontal ? inner.h : inner.w, !catHorizontal, percent, firstFormat(chart, false), chart) : null;
    if (innerGiven) break;
    const vertical = catHorizontal ? val : cat;
    const across = catHorizontal ? cat : val;
    const labelled = (a: AxisLayout | null): boolean => !!a && !a.axis.deleted && a.axis.labels !== "none";
    // Room for an axis's labels on the side they hang off, when outside.
    const room = (a: AxisLayout | null, isCat: boolean, free: number): { before: number; after: number } => {
      if (!a) return { before: 0, after: 0 };
      const other = isCat ? val : cat;
      const pl = isCat ? categoryPlacement(a, val) : valuePlacement(a, cat);
      const depth = a.axis.labels === "none" && !a.axis.deleted ? free : pl.outside ? a.depth : 0;
      const onAfter = after(pl.toward, isCat, catHorizontal, other?.axis.reversed ?? false);
      return onAfter ? { before: 0, after: depth } : { before: depth, after: 0 };
    };
    const v = room(vertical, vertical === cat, NO_LABELS.beside);
    const h = room(across, across === cat, NO_LABELS.across);
    // The last label of a horizontal value axis hangs half out past its end.
    const overhang = across?.scale && labelled(across) ? textWidth(across.labels[across.labels.length - 1]?.text ?? "", across.axis.font) / 2 : 0;
    // A label slanting down to the left from the first category must fit.
    const first = across && !across.scale && across.rotation < 0 ? across.labels[0] : undefined;
    const slant = first && across
      ? textWidth(first.text, across.axis.font) * Math.cos((across.rotation * Math.PI) / 180) - first.t * inner.w
      : 0;
    const left = Math.max(v.before + titleBand(vertical?.axis ?? null), slant);
    const right = v.after || (overhang ? Math.max(VALUE_RIGHT, overhang + OVERHANG_GAP) : PLOT_RIGHT);
    const bottom = h.after + titleBand(across?.axis ?? null);
    const top = h.before || (vertical?.scale && labelled(vertical) ? PLOT_TOP : PLOT_TOP_BARE);
    inner = { x: outer.x + left, y: outer.y + top, w: Math.max(1, outer.w - left - right), h: Math.max(1, outer.h - top - bottom) };
  }

  const vScale = val?.scale ?? { min: 0, max: 1, major: 0.2, minor: 0.04 };
  const valLength = catHorizontal ? inner.h : inner.w;
  const catLength = catHorizontal ? inner.w : inner.h;
  const valRev = valAxis?.reversed === true;
  const catRev = catAxis?.reversed === true;
  const valPos = (v: number): number => {
    const t = (v - vScale.min) / (vScale.max - vScale.min || 1);
    const tt = valRev ? 1 - t : t;
    return catHorizontal ? inner.y + inner.h - tt * valLength : inner.x + tt * valLength;
  };
  // Category axes run left to right, and bottom to top on horizontal bars.
  const catAt = (t: number): number => {
    const tt = catRev ? 1 - t : t;
    return catHorizontal ? inner.x + tt * catLength : inner.y + inner.h - tt * catLength;
  };
  const fallbackSlot = (i: number): number => (onTicks ? (count > 1 ? i / (count - 1) : 0.5) : (i + 0.5) / count);
  const catPos = (i: number): number => catAt((cat?.slot ?? fallbackSlot)(i));

  // Axis titles.
  const addTitle = (axis: ChartAxis | null, side: "b" | "l"): void => {
    if (!axis?.title || axis.deleted) return;
    const b = block(axis.title.text);
    if (side === "b") out.axisTitles.push({ title: axis.title, rect: { x: inner.x + (inner.w - b.w) / 2, y: outer.y + outer.h - b.h, w: b.w, h: b.h }, rotation: 0 });
    else {
      const cy = inner.y + inner.h / 2;
      out.axisTitles.push({ title: axis.title, rect: { x: outer.x + b.h / 2 - b.w / 2, y: cy - b.h / 2, w: b.w, h: b.h }, rotation: axis.title.rotation ?? -90 });
    }
  };
  addTitle(catHorizontal ? catAxis : valAxis, "b");
  addTitle(catHorizontal ? valAxis : catAxis, "l");

  return { inner, cat, val, catPos, catAt, valPos, horizontal: !!horizontal };
}

/**
 * Where an axis goes, in fractions along the OTHER axis (0 = its start): its
 * line crosses at `line`; its labels hang off `labels` towards `toward` (-1:
 * the start's side, +1: the end's), and are `outside` the plot when that is
 * one of its edges — only then does the plot make room for them. Labels sit
 * on the low side of the line, unless the line is the far edge.
 */
type Placement = { line: number; labels: number; toward: -1 | 1; outside: boolean };

function placement(cross: number, labels: ChartAxis["labels"]): Placement {
  const at = labels === "low" ? 0 : labels === "high" ? 1 : Math.min(1, Math.max(0, cross));
  return { line: Math.min(1, Math.max(0, cross)), labels: at, toward: at >= 1 - 1e-9 ? 1 : -1, outside: at <= 1e-9 || at >= 1 - 1e-9 };
}

/** The category axis crosses the values at zero (or the end the data are on). */
function categoryPlacement(cat: AxisLayout, val: AxisLayout | null): Placement {
  const sc = val?.scale;
  if (!sc) return placement(0, cat.axis.labels);
  const c = cat.axis.crosses;
  const v = typeof c === "number" ? c : c === "max" ? sc.max : c === "min" ? sc.min : sc.min > 0 ? sc.min : sc.max < 0 ? sc.max : 0;
  return placement((v - sc.min) / (sc.max - sc.min || 1), cat.axis.labels);
}

/** The value axis crosses the categories at their start (or end); on a
 *  scatter, at the X value. */
function valuePlacement(val: AxisLayout, cat: AxisLayout | null): Placement {
  const c = val.axis.crosses;
  if (cat?.scale) {
    const sc = cat.scale;
    const v = typeof c === "number" ? c : c === "max" ? sc.max : c === "min" ? sc.min : sc.min > 0 ? sc.min : sc.max < 0 ? sc.max : 0;
    return placement((v - sc.min) / (sc.max - sc.min || 1), val.axis.labels);
  }
  return placement(c === "max" ? 1 : 0, val.axis.labels);
}

/** Whether labels moving `toward` along an axis go right/down on screen. */
function after(toward: -1 | 1, alongValues: boolean, columns: boolean, reversed: boolean): boolean {
  // Values grow upwards on columns and rightwards on bars; categories grow
  // rightwards on columns and upwards on bars.
  const growsPositive = alongValues ? !columns : columns;
  return (toward > 0) === growsPositive !== reversed;
}

function valueRange(chart: Chart): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of chart.plots) {
    if (p.kind === "pie") continue;
    const stacked = p.kind !== "scatter" && (p.grouping === "stacked" || p.grouping === "percentStacked");
    if (p.kind !== "scatter" && p.grouping === "percentStacked") {
      const neg = p.series.some((s) => s.values.values.some((v) => typeof v === "number" && v < 0));
      lo = Math.min(lo, neg ? -1 : 0);
      hi = Math.max(hi, 1);
      continue;
    }
    if (stacked) {
      const n = Math.max(...p.series.map((s) => s.values.values.length));
      for (let i = 0; i < n; i++) {
        let pos = 0;
        let neg = 0;
        for (const s of p.series) {
          const v = s.values.values[i];
          if (typeof v === "number") {
            if (v >= 0) pos += v;
            else neg += v;
          }
        }
        hi = Math.max(hi, pos);
        lo = Math.min(lo, neg);
      }
    } else {
      for (const s of p.series) for (const v of s.values.values) if (typeof v === "number") {
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
    }
    if (p.kind === "bar" || p.kind === "area") {
      lo = Math.min(lo, 0);
      hi = Math.max(hi, 0);
    }
  }
  if (lo === Infinity) return [0, 1];
  return [lo, hi];
}

/** The first series' number format, of its values or (scatter) its X values:
 *  what a source-linked axis shows. */
function firstFormat(chart: Chart, x: boolean): string {
  const s = chart.plots[0]?.series[0];
  return (x ? s?.xValues?.format : s?.values.format) ?? "General";
}

function xValuesOf(s: ChartSeries): (number | null)[] {
  const xs = s.xValues?.values;
  const n = s.values.values.length;
  if (!xs || xs.some((v) => typeof v === "string")) return Array.from({ length: n }, (_, i) => i + 1);
  return Array.from({ length: n }, (_, i) => {
    const x = xs[i];
    return typeof x === "number" ? x : null;
  });
}

function xRange(chart: Chart): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of chart.plots) for (const s of p.series) for (const v of xValuesOf(s)) if (v !== null) {
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  return lo === Infinity ? [0, 1] : [lo, hi];
}

/**
 * The room Office counts per tick label, in label line heights: an automatic
 * major unit is kept only if all its labels fit the axis at that much each,
 * and never more than ten majors. Fitted on fifteen automatic axes
 * (`cht-chart-type`, `cht-category-access`, `cht-datalabels`, `cht-axis-props`,
 * `cht-series`, `shp-access-chart`, `tdf112089`, `bar-chart`, two AASCU
 * decks; 10, 12 and 18 pt), which a spacing threshold can't explain: at 18 pt
 * 26.57 pt between majors is refused on one axis and 26.4 pt taken on
 * another — it's the label count that differs. Horizontal axes, dates
 * included, count about twice the room.
 */
const LABEL_ROOM = { vertical: 1.075, horizontal: 2.07 };
const MAX_INTERVALS = 10;

function valueAxisLayout(axis: ChartAxis, lo: number, hi: number, length: number, horizontal: boolean, percent: boolean, source: string, chart: Chart): AxisLayout {
  const font = axis.font;
  const fmt = axis.format ?? (percent ? "0%" : source);
  const scale = valueScale(lo, hi, axis, length, (horizontal ? LABEL_ROOM.horizontal : LABEL_ROOM.vertical) * lineHeight(font), percent);
  const shown = !axis.deleted && axis.labels !== "none";
  const labels = shown ? ticks(scale, scale.major).map((v) => ({ text: formatValue(v, fmt, chart.date1904), at: v, t: 0 })) : [];
  const tickOut = !axis.deleted && (axis.majorTick === "out" || axis.majorTick === "cross") ? tickLength(axis) : 0;
  const depth = shown
    ? horizontal
      ? lineHeight(font) + categoryGap(tickOut, 100)
      : Math.max(0, ...labels.map((l) => textWidth(l.text, font))) + valueGap(tickOut)
    : tickOut;
  const span = scale.max - scale.min || 1;
  const slot = (v: number): number => (v - scale.min) / span;
  return {
    axis,
    horizontal,
    scale,
    count: 0,
    onTicks: false,
    labels: labels.map((l) => ({ ...l, t: slot(l.at) })),
    tickTs: ticks(scale, scale.major).map(slot),
    slot,
    band: (length * scale.major) / span,
    rotation: 0,
    wrap: 0,
    depth,
    leafDepth: depth,
    groups: [],
  };
}

/**
 * A date axis with daily (or weekly) data is a time scale: each date sits at
 * its own day, one day wide, and labels come every few days — the finest of
 * 1, 2, 3, 7 or 14 days whose labels fit like value labels do. Coarser data (months,
 * years) is laid out by index, which is what an even calendar step looks like.
 */
function dateScale(
  values: (number | string | null)[],
  count: number,
  onTicks: boolean,
  length: number,
  room: number,
): { min: number; span: number; unit: number; days: number[] } | null {
  const days = values.slice(0, count).map((v) => (typeof v === "number" ? Math.floor(v) : NaN));
  if (days.length < 2 || days.some((d) => !Number.isFinite(d))) return null;
  const sorted = [...days].sort((x, y) => x - y);
  const gap = Math.min(...sorted.slice(1).map((d, i) => d - sorted[i]!).filter((d) => d > 0));
  if (!Number.isFinite(gap) || gap >= 28) return null;
  const min = sorted[0]!;
  const span = sorted[sorted.length - 1]! - min + (onTicks ? 0 : 1) || 1;
  const last = sorted[sorted.length - 1]! - min;
  const unit = [1, 2, 3, 7, 14, 28].find((u) => (Math.floor(last / u) + 1) * room <= length) ?? 28;
  return { min, span, unit, days };
}

function categoryAxisLayout(axis: ChartAxis, chart: Chart, count: number, onTicks: boolean, length: number, horizontal: boolean): AxisLayout {
  const font = axis.font;
  const shown = !axis.deleted && axis.labels !== "none";
  const fmt = axis.format ?? chart.categories.format;
  const dates = axis.kind === "date" ? dateScale(chart.categories.values, count, onTicks, length, LABEL_ROOM.horizontal * lineHeight(font)) : null;
  let slot: (i: number) => number;
  let items: { text: string; at: number; t: number }[];
  let tickTs: number[];
  let band: number;
  let spacing: number;
  if (dates) {
    slot = (i) => ((dates.days[i] ?? dates.min) - dates.min + (onTicks ? 0 : 0.5)) / dates.span;
    band = length / dates.span;
    items = [];
    for (let d = dates.min; d - dates.min <= dates.span - (onTicks ? 0 : 1) + 1e-9; d += dates.unit) {
      items.push({ text: formatValue(d, fmt, chart.date1904), at: d, t: (d - dates.min) / dates.span });
    }
    tickTs = items.map((l) => l.t);
    spacing = band * dates.unit;
  } else {
    slot = (i) => (onTicks ? (count > 1 ? i / (count - 1) : 0.5) : (i + 0.5) / count);
    band = length / Math.max(1, onTicks ? count - 1 : count);
    items = Array.from({ length: count }, (_, i) => ({
      text: formatValue(chart.categories.values[i] ?? (chart.categories.values.length ? null : i + 1), fmt, chart.date1904),
      at: i,
      t: slot(i),
    }));
    const step = axis.tickSkip ?? 1;
    tickTs = [];
    if (onTicks) for (let i = 0; i < count; i += step) tickTs.push(slot(i));
    else for (let i = 0; i <= count; i += step) tickTs.push(i / count);
    spacing = band;
  }
  const texts = items.map((l) => l.text);
  const lh = lineHeight(font);
  let rotation = 0;
  let wrap = 0;
  let skip = axis.labelSkip ?? 1;
  let depthText = 0;
  if (shown && horizontal) {
    // A label gets its whole band: 78.8 pt of "Category 1" stays on one line
    // in a 79.3 pt band (`cht-axis-props`).
    const room = spacing * skip;
    const widest = Math.max(0, ...texts.map((t) => textWidth(t, font)));
    if (axis.rotation !== null && axis.rotation !== 0) {
      rotation = axis.rotation;
    } else if (widest > room) {
      // Broken at spaces when every word fits; slanted otherwise — upright
      // under groups of categories.
      const fits = texts.every((t) => plainBlock(t, font, room).w <= room);
      if (axis.rotation === 0 || fits) wrap = room;
      else rotation = chart.categoryGroups.length ? -90 : -45;
    }
    if (rotation && axis.labelSkip === null) {
      const need = Math.abs(lh / Math.sin((Math.abs(rotation) * Math.PI) / 180));
      skip = Math.max(1, Math.ceil(need / spacing - 1e-6));
    }
    if (rotation) {
      const a = (Math.abs(rotation) * Math.PI) / 180;
      depthText = Math.max(0, ...texts.map((t) => textWidth(t, font) * Math.sin(a) + lh * Math.cos(a)));
    } else if (wrap) depthText = Math.max(...texts.map((t) => plainBlock(t, font, wrap).h));
    else depthText = lh;
  } else if (shown) {
    if (axis.labelSkip === null) skip = Math.max(1, Math.ceil(lh / spacing - 1e-6));
    depthText = Math.max(0, ...texts.map((t) => textWidth(t, font)));
  }
  const tickOut = !axis.deleted && (axis.majorTick === "out" || axis.majorTick === "cross") ? tickLength(axis) : 0;
  const gap = horizontal ? categoryGap(tickOut, axis.labelOffset) : tickOut + (6.1 * PT * axis.labelOffset) / 100;
  return {
    axis,
    horizontal,
    scale: null,
    count,
    onTicks,
    labels: shown ? items.filter((_, i) => i % skip === 0) : [],
    tickTs,
    slot,
    band,
    rotation,
    wrap,
    // Each level of groups takes a row as deep as a label and its gap.
    depth: shown ? depthText + gap + (horizontal ? chart.categoryGroups.length * (gap + lh) : 0) : tickOut,
    leafDepth: shown ? depthText + gap : tickOut,
    groups: horizontal && shown ? chart.categoryGroups : [],
  };
}

// ── Painting ────────────────────────────────────────────────────────────────

type Paint = {
  box: (b: ChartBox, r: Rect) => ReactNode;
  /** A rectangle, or a path in the coordinates of `box` (its gradient's box). */
  shape: (d: string | Rect, fill: Fill | null, line: Line | null, effects: Effects | null, box?: Rect) => ReactNode;
  /** Shapes under one shadow, the series' (a union, like Office's). */
  group: (shapes: ReactNode[], effects: Effects | null) => ReactNode;
};

function paintWith(defs: ReactNode[], key: () => string, resolve: ResolvePart | null): Paint {
  const ctx = (r: Rect): PaintContext => ({ resolve: resolve ?? ((p) => p), background: null, slide: { w: r.w, h: r.h }, at: { x: r.x, y: r.y } });
  // Without the package's parts a picture can't be drawn; a slide's
  // background behind a chart is what shows through it anyway.
  const drawable = (f: Fill | null | undefined): Fill | null => (!f || f.kind === "background" || (f.kind === "image" && !resolve) ? null : f);
  const shape = (d: string | Rect, fill: Fill | null, line: Line | null, effects: Effects | null, pathBox?: Rect): ReactNode => {
    const k = key();
    const r = typeof d === "string" ? (pathBox ?? null) : d;
    const f = drawable(fill);
    const lf = drawable(line?.fill);
    if (!f && !lf) return null;
    const boxOf = r ?? { x: 0, y: 0, w: 1, h: 1 };
    const fillPaint = svgPaint(f, `${k}f`, ctx(boxOf), { w: boxOf.w, h: boxOf.h });
    const linePaint = svgPaint(lf, `${k}l`, ctx(boxOf), { w: boxOf.w, h: boxOf.h });
    const stroke = line ? strokeProps(line, linePaint.paint) : { stroke: "none" };
    return (
      <g key={k} filter={shadow(effects, k)} transform={r ? `translate(${r.x} ${r.y})` : undefined}>
        {fillPaint.defs || linePaint.defs ? (
          <defs>
            {fillPaint.defs}
            {linePaint.defs}
          </defs>
        ) : null}
        {typeof d === "string" ? (
          <path d={d} fill={fillPaint.paint} {...stroke} />
        ) : (
          <rect width={Math.max(0, d.w)} height={Math.max(0, d.h)} fill={fillPaint.paint} {...stroke} />
        )}
      </g>
    );
  };
  /** An outer shadow as a filter in the shared defs; its `url()`. */
  const shadow = (effects: Effects | null, k: string): string | undefined => {
    const sh = effects?.shadow;
    if (!sh || sh.inner) return undefined;
    const a = (sh.dir * Math.PI) / 180;
    defs.push(
      <filter key={`${k}s`} id={`${k}s`} x="-50%" y="-50%" width="200%" height="200%">
        <feDropShadow dx={Math.cos(a) * sh.dist} dy={Math.sin(a) * sh.dist} stdDeviation={sh.blur / 2} floodColor={sh.color} />
      </filter>,
    );
    return `url(#${k}s)`;
  };
  const group = (shapes: ReactNode[], effects: Effects | null): ReactNode => {
    const k = key();
    return (
      <g key={k} filter={shadow(effects, k)}>
        {shapes}
      </g>
    );
  };
  return { shape, group, box: (b, r) => shape(r, b.fill, b.line, b.effects) };
}

/** Gridlines go under the series. */
function drawAxesBehind(plot: PlotLayout, key: () => string): ReactNode[] {
  const out: ReactNode[] = [];
  const { inner } = plot;
  const catHorizontal = !plot.horizontal;
  const line = (x1: number, y1: number, x2: number, y2: number, l: Line): ReactNode => (
    <line key={key()} x1={x1} y1={y1} x2={x2} y2={y2} {...strokeProps(l, l.fill?.kind === "solid" ? l.fill.color : "none")} />
  );
  const val = plot.val;
  if (val?.scale) {
    for (const [grid, step] of [
      [val.axis.minorGrid, val.scale.minor],
      [val.axis.majorGrid, val.scale.major],
    ] as const) {
      if (!grid) continue;
      for (const v of ticks(val.scale, step)) {
        const p = plot.valPos(v);
        out.push(catHorizontal ? line(inner.x, p, inner.x + inner.w, p, grid) : line(p, inner.y, p, inner.y + inner.h, grid));
      }
    }
  }
  const cat = plot.cat;
  if (cat) {
    for (const grid of [cat.axis.minorGrid, cat.axis.majorGrid]) {
      if (!grid) continue;
      for (const p of categoryTicks(plot, cat)) out.push(catHorizontal ? line(p, inner.y, p, inner.y + inner.h, grid) : line(inner.x, p, inner.x + inner.w, p, grid));
    }
  }
  return out;
}

/** Where a category axis has its ticks. */
function categoryTicks(plot: PlotLayout, cat: AxisLayout): number[] {
  return cat.tickTs.map((t) => plot.catAt(t));
}

/** Axis lines, ticks and labels go over the series. */
function drawAxesFront(plot: PlotLayout, key: () => string): ReactNode[] {
  const out: ReactNode[] = [];
  const { inner } = plot;
  const columns = !plot.horizontal;
  const val = plot.val;
  const cat = plot.cat;
  const stroke = (l: Line | null): Record<string, string | number | undefined> => strokeProps(l, l?.fill?.kind === "solid" ? l.fill.color : "none");
  const sc = val?.scale ?? null;
  // Fractions along each axis, as coordinates.
  const alongValues = (t: number): number => (sc ? plot.valPos(sc.min + t * (sc.max - sc.min)) : columns ? inner.y + inner.h : inner.x);
  const alongCategories = (t: number): number => plot.catAt(t);

  if (cat && !cat.axis.deleted) {
    const pl = categoryPlacement(cat, val);
    const at = alongValues(pl.line);
    const dir = after(pl.toward, true, columns, val?.axis.reversed ?? false) ? 1 : -1;
    if (cat.axis.line?.fill) {
      out.push(
        columns ? (
          <line key={key()} x1={inner.x} y1={at} x2={inner.x + inner.w} y2={at} {...stroke(cat.axis.line)} />
        ) : (
          <line key={key()} x1={at} y1={inner.y} x2={at} y2={inner.y + inner.h} {...stroke(cat.axis.line)} />
        ),
      );
    }
    if (cat.groups.length) out.push(...categoryGroups(plot, cat, alongValues(pl.labels), dir, key));
    else out.push(...tickMarks(categoryTicks(plot, cat), at, cat.axis, columns, dir, key));
    out.push(...categoryLabels(plot, cat, alongValues(pl.labels), dir, columns, key));
  }
  if (val && !val.axis.deleted && sc) {
    const pl = valuePlacement(val, cat);
    const at = alongCategories(pl.line);
    const dir = after(pl.toward, false, columns, cat?.axis.reversed ?? false) ? 1 : -1;
    if (val.axis.line?.fill) {
      out.push(
        columns ? (
          <line key={key()} x1={at} y1={inner.y} x2={at} y2={inner.y + inner.h} {...stroke(val.axis.line)} />
        ) : (
          <line key={key()} x1={inner.x} y1={at} x2={inner.x + inner.w} y2={at} {...stroke(val.axis.line)} />
        ),
      );
    }
    out.push(...tickMarks(ticks(sc, sc.major).map((v) => plot.valPos(v)), at, val.axis, !columns, dir, key));
    const tickOut = val.axis.majorTick === "out" || val.axis.majorTick === "cross" ? tickLength(val.axis) : 0;
    const font = val.axis.font;
    const edge = alongCategories(pl.labels);
    for (const l of val.labels) {
      const p = plot.valPos(l.at);
      if (columns) {
        const x = edge + dir * valueGap(tickOut);
        out.push(label(l.text, font, x, p - lineHeight(font) / 2, dir < 0 ? "end" : "start", key()));
      } else {
        const gap = categoryGap(tickOut, 100);
        out.push(label(l.text, font, p, dir > 0 ? edge + gap : edge - gap - lineHeight(font), "middle", key()));
      }
    }
  }
  return out;
}

/** Tick marks across an axis at `at`; `dir` is the outside's direction. */
function tickMarks(pos: number[], at: number, axis: ChartAxis, horizontalAxis: boolean, dir: number, key: () => string): ReactNode[] {
  const kind = axis.majorTick;
  const line = axis.line;
  if (kind === "none" || !line?.fill) return [];
  const outward = kind === "in" ? 0 : tickLength(axis);
  const inward = kind === "out" ? 0 : tickLength(axis);
  const s = strokeProps(line, line.fill.kind === "solid" ? line.fill.color : "none");
  return pos.map((p) =>
    horizontalAxis ? (
      <line key={key()} x1={p} y1={at - inward * dir} x2={p} y2={at + outward * dir} {...s} />
    ) : (
      <line key={key()} x1={at - inward * dir} y1={p} x2={at + outward * dir} y2={p} {...s} />
    ),
  );
}

/**
 * Multi-level categories under a horizontal axis: a row per level, each as
 * deep as a label and its gap, the groups' labels centred over their
 * categories; lines between the categories run through the labels' row, and
 * between groups through every row down to theirs (`cht-category-access`).
 */
function categoryGroups(plot: PlotLayout, cat: AxisLayout, at: number, dir: number, key: () => string): ReactNode[] {
  const out: ReactNode[] = [];
  const line = cat.axis.line;
  const s = line?.fill ? strokeProps(line, line.fill.kind === "solid" ? line.fill.color : "none") : null;
  const font = cat.axis.font;
  const gap = categoryGap(cat.axis.majorTick === "out" || cat.axis.majorTick === "cross" ? tickLength(cat.axis) : 0, cat.axis.labelOffset);
  const row = gap + lineHeight(font);
  const rule = (t: number, depth: number): void => {
    const x = plot.catAt(t);
    if (s) out.push(<line key={key()} x1={x} y1={at} x2={x} y2={at + dir * depth} {...s} />);
  };
  const bottom = cat.leafDepth + cat.groups.length * row;
  for (const t of cat.tickTs) rule(t, t <= 1e-9 || t >= 1 - 1e-9 ? bottom : cat.leafDepth);
  cat.groups.forEach((level, k) => {
    const depth = cat.leafDepth + (k + 1) * row;
    const top = at + dir * (cat.leafDepth + k * row) + (dir > 0 ? gap : -gap - lineHeight(font));
    level.forEach((g, i) => {
      const end = level[i + 1]?.start ?? cat.count;
      if (g.start > 0) rule(g.start / cat.count, depth);
      out.push(label(g.text, font, plot.catAt((g.start + end) / 2 / cat.count), top, "middle", key()));
    });
  });
  return out;
}

function categoryLabels(plot: PlotLayout, cat: AxisLayout, at: number, dir: number, horizontal: boolean, key: () => string): ReactNode[] {
  const font = cat.axis.font;
  const tickOut = cat.axis.majorTick === "out" || cat.axis.majorTick === "cross" ? tickLength(cat.axis) : 0;
  const gap = horizontal ? categoryGap(tickOut, cat.axis.labelOffset) : tickOut + (6.1 * PT * cat.axis.labelOffset) / 100;
  const lh = lineHeight(font);
  const out: ReactNode[] = [];
  for (const l of cat.labels) {
    const p = plot.catAt(l.t);
    if (horizontal) {
      const b = cat.wrap ? plainBlock(l.text, font, cat.wrap) : null;
      const top = dir > 0 ? at + gap : at - gap - (b?.h ?? lh);
      if (cat.rotation) {
        // A slanted label hangs from its category: at 45° the corner of its
        // box that ends up highest sits under the category's centre; at 90°
        // the box is centred on it (`cht-chart-props`, the AASCU combo).
        const a = (cat.rotation * Math.PI) / 180;
        const x = p - (lh / 2) * Math.SQRT2 * Math.sin(a) * Math.cos(a);
        const y = top + metrics(font)[0] * font.size * PT - lh / 2;
        out.push(svgText([{ text: l.text, font }], x, y, cat.rotation < 0 ? "end" : "start", [cat.rotation, x, top], key()));
      } else if (b) out.push(drawText(b, { x: p - b.w / 2, y: top, w: b.w, h: b.h }, 0, key()));
      else out.push(label(l.text, font, p, top, "middle", key()));
    } else {
      out.push(label(l.text, font, at + dir * gap, p - lh / 2, dir < 0 ? "end" : "start", key()));
    }
  }
  return out;
}

// ── Plots ───────────────────────────────────────────────────────────────────

function pointStyle(s: ChartSeries, i: number): { fill: Fill | null; line: Line | null; effects: Effects | null; marker: ChartMarker | null } {
  const p = s.points?.[i];
  return p ? { fill: p.fill, line: p.line, effects: p.effects, marker: p.marker } : { fill: s.fill, line: s.line, effects: s.effects, marker: s.marker };
}

const num = (v: number | string | null | undefined): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function drawPlot(p: ChartPlot, layout: Layout, paint: Paint): ReactNode {
  const plot = layout.plot;
  const out: ReactNode[] = [];
  if (p.kind === "pie") return layout.pie ? paint.group(drawPie(p, layout.pie, paint), null) : null;
  if (!plot || !plot.val?.scale) return null;
  const scale = plot.val.scale;
  const count = plot.cat?.count ?? 1;

  if (p.kind === "bar") {
    const n = p.grouping === "clustered" || p.grouping === "standard" ? p.series.length : 1;
    const catLen = plot.cat?.band ?? (plot.horizontal ? plot.inner.h : plot.inner.w) / count;
    const overlap = Math.max(-100, Math.min(100, p.grouping === "clustered" || p.grouping === "standard" ? p.overlap : 100)) / 100;
    // n bars, each overlapping the next by `overlap` of a bar, and a gap
    // between groups of `gapWidth` percent of a bar.
    const bw = catLen / (n - (n - 1) * overlap + p.gapWidth / 100);
    const stackPos: number[] = Array.from({ length: count }, () => 0);
    const stackNeg: number[] = Array.from({ length: count }, () => 0);
    const totals = Array.from({ length: count }, (_, i) => p.series.reduce((sum, s) => sum + Math.abs(num(s.values.values[i]) ?? 0), 0));
    p.series.forEach((s, k) => {
      const shapes: ReactNode[] = [];
      for (let i = 0; i < count; i++) {
        let v = num(s.values.values[i]);
        if (v === null) continue;
        if (p.grouping === "percentStacked") v = totals[i] ? v / totals[i]! : 0;
        let from = 0;
        let to = v;
        if (p.grouping === "stacked" || p.grouping === "percentStacked") {
          if (v >= 0) {
            from = stackPos[i]!;
            to = from + v;
            stackPos[i] = to;
          } else {
            from = stackNeg[i]!;
            to = from + v;
            stackNeg[i] = to;
          }
        }
        const clamp = (x: number): number => Math.min(scale.max, Math.max(scale.min, x));
        const a = plot.valPos(clamp(from === 0 ? Math.min(scale.max, Math.max(scale.min, 0)) : from));
        const b = plot.valPos(clamp(to));
        const center = plot.catPos(i);
        const slot = n === 1 ? 0 : k * bw * (1 - overlap) - ((n - 1) * bw * (1 - overlap)) / 2;
        // Bars go left to right in series order; on horizontal bars, bottom to top.
        const c = plot.horizontal ? center - slot : center + slot;
        const rect: Rect = plot.horizontal
          ? { x: Math.min(a, b), y: c - bw / 2, w: Math.abs(b - a), h: bw }
          : { x: c - bw / 2, y: Math.min(a, b), w: bw, h: Math.abs(b - a) };
        const st = pointStyle(s, i);
        shapes.push(paint.shape(rect, st.fill, st.line, null));
      }
      out.push(paint.group(shapes, s.effects));
    });
    return paint.group(out, null);
  }

  if (p.kind === "area" || p.kind === "line") {
    const stacked = p.grouping === "stacked" || p.grouping === "percentStacked";
    const acc = Array.from({ length: count }, () => 0);
    const totals = Array.from({ length: count }, (_, i) => p.series.reduce((sum, s) => sum + (num(s.values.values[i]) ?? 0), 0));
    const layers: { s: ChartSeries; pts: ([number, number] | null)[]; lower: [number, number][] }[] = [];
    for (const s of p.series) {
      const pts: ([number, number] | null)[] = [];
      const lower: [number, number][] = [];
      for (let i = 0; i < count; i++) {
        let v = num(s.values.values[i]);
        if (v !== null && p.grouping === "percentStacked") v = totals[i] ? v / totals[i]! : 0;
        const prev = acc[i]!;
        const top = stacked ? prev + (v ?? 0) : v;
        if (stacked) acc[i] = top ?? prev;
        const x = plot.catPos(i);
        lower.push(plot.horizontal ? [plot.valPos(stacked ? prev : 0), x] : [x, plot.valPos(stacked ? prev : Math.min(scale.max, Math.max(scale.min, 0)))]);
        if (top === null || (v === null && !stacked)) pts.push(null);
        else pts.push(plot.horizontal ? [plot.valPos(top), x] : [x, plot.valPos(top)]);
      }
      layers.push({ s, pts, lower });
    }
    if (p.kind === "area") {
      for (const { s, pts, lower } of layers) {
        const ring = [...pts.map((q, i) => q ?? lower[i]!), ...lower.slice().reverse()];
        const box = boundsOf(ring);
        const d = `M${ring.map((q) => `${q[0] - box.x} ${q[1] - box.y}`).join("L")}Z`;
        out.push(paint.group([paint.shape(d, s.fill, s.line, null, box)], s.effects));
      }
      return paint.group(out, null);
    }
    for (const { s, pts } of layers) out.push(drawLine(s, pts, paint));
    return paint.group(out, null);
  }

  // Scatter.
  for (const s of p.series) {
    const xs = xValuesOf(s);
    const pts = s.values.values.map((v, i) => {
      const y = num(v);
      const x = xs[i];
      return y === null || x === null || x === undefined ? null : ([plot.catPos(x), plot.valPos(y)] as [number, number]);
    });
    out.push(drawLine(s, pts, paint));
  }
  return paint.group(out, null);
}

function boundsOf(points: [number, number][]): Rect {
  const xs = points.map((q) => q[0]);
  const ys = points.map((q) => q[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x || 1, h: Math.max(...ys) - y || 1 };
}

/** A series' line (straight or smoothed, broken at gaps) and its markers. */
function drawLine(s: ChartSeries, pts: ([number, number] | null)[], paint: Paint): ReactNode {
  const out: ReactNode[] = [];
  if (s.line?.fill) {
    let d = "";
    let run: [number, number][] = [];
    const flush = (): void => {
      if (run.length > 1) d += s.smooth ? smoothPath(run) : `M${run.map((q) => `${q[0]} ${q[1]}`).join("L")}`;
      run = [];
    };
    for (const q of pts) {
      if (q) run.push(q);
      else flush();
    }
    flush();
    if (d) out.push(paint.shape(d, null, { ...s.line, join: "round" }, null));
  }
  pts.forEach((q, i) => {
    const m = pointStyle(s, i).marker;
    if (q && m) out.push(drawMarker(m, q[0], q[1], paint));
  });
  return paint.group(out, s.effects);
}

function drawMarker(m: ChartMarker, x: number, y: number, paint: Paint, size = m.size): ReactNode {
  const r = (size * PT) / 2;
  const sized = { ...m, size };
  return paint.shape(markerPath(sized, r, r), m.fill, m.line, m.effects, { x: x - r, y: y - r, w: 2 * r, h: 2 * r });
}

/** Office smooths with a Catmull-Rom-like spline through the points. */
function smoothPath(p: [number, number][]): string {
  let d = `M${p[0]![0]} ${p[0]![1]}`;
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[i - 1] ?? p[i]!;
    const p1 = p[i]!;
    const p2 = p[i + 1]!;
    const p3 = p[i + 2] ?? p2;
    const t = 1 / 6;
    d += `C${p1[0] + (p2[0] - p0[0]) * t} ${p1[1] + (p2[1] - p0[1]) * t} ${p2[0] - (p3[0] - p1[0]) * t} ${p2[1] - (p3[1] - p1[1]) * t} ${p2[0]} ${p2[1]}`;
  }
  return d;
}

function markerPath(m: ChartMarker, x: number, y: number): string {
  const r = (m.size * PT) / 2;
  switch (m.symbol) {
    case "square":
      return `M${x - r} ${y - r}h${2 * r}v${2 * r}h${-2 * r}Z`;
    case "diamond":
      return `M${x} ${y - r}L${x + r} ${y}L${x} ${y + r}L${x - r} ${y}Z`;
    case "triangle":
      return `M${x} ${y - r}L${x + r} ${y + r}L${x - r} ${y + r}Z`;
    case "x":
      return `M${x - r} ${y - r}L${x + r} ${y + r}M${x + r} ${y - r}L${x - r} ${y + r}`;
    case "star":
      return `M${x - r} ${y - r}L${x + r} ${y + r}M${x + r} ${y - r}L${x - r} ${y + r}M${x} ${y - r}V${y + r}`;
    case "plus":
      return `M${x - r} ${y}H${x + r}M${x} ${y - r}V${y + r}`;
    case "dash":
      return `M${x - r} ${y - r / 4}h${2 * r}v${r / 2}h${-2 * r}Z`;
    case "dot": {
      const q = r / 2;
      return `M${x - q} ${y}a${q} ${q} 0 1 0 ${2 * q} 0a${q} ${q} 0 1 0 ${-2 * q} 0Z`;
    }
    case "none":
      return "";
    default:
      return `M${x - r} ${y}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;
  }
}

type Slice = { s: ChartSeries; i: number; value: number; start: number; sweep: number; r0: number; r1: number; total: number };

/** A pie's slices — a doughnut's, ring by ring from the hole out: angles
 *  clockwise from twelve o'clock, radii. */
function slices(p: Extract<ChartPlot, { kind: "pie" }>, pie: { r: number }): Slice[][] {
  const rings = p.holeSize > 0 ? p.series : p.series.slice(0, 1);
  const hole = (pie.r * p.holeSize) / 100;
  const ringW = (pie.r - hole) / Math.max(1, rings.length);
  return rings.map((s, k) => {
    const values = s.values.values.map((v) => Math.max(0, num(v) ?? 0));
    const total = values.reduce((a, b) => a + b, 0);
    let angle = p.firstSliceAngle;
    return values.map((value, i) => {
      const sweep = total ? (value / total) * 360 : 0;
      const slice = { s, i, value, start: angle, sweep, r0: p.holeSize > 0 ? hole + ringW * k : 0, r1: p.holeSize > 0 ? hole + ringW * (k + 1) : pie.r, total };
      angle += sweep;
      return slice;
    });
  });
}

function drawPie(p: Extract<ChartPlot, { kind: "pie" }>, pie: { cx: number; cy: number; r: number }, paint: Paint): ReactNode[] {
  const box = { x: pie.cx - pie.r, y: pie.cy - pie.r, w: 2 * pie.r, h: 2 * pie.r };
  return slices(p, pie).map((ring) => {
    const shapes = ring
      .filter((sl) => sl.value > 0)
      .map((sl) => {
        const st = pointStyle(sl.s, sl.i);
        const explosion = ((sl.s.points?.[sl.i]?.explosion ?? sl.s.explosion) / 100) * pie.r;
        const mid = ((sl.start + sl.sweep / 2 - 90) * Math.PI) / 180;
        const cx = pie.cx + Math.cos(mid) * explosion - box.x;
        const cy = pie.cy + Math.sin(mid) * explosion - box.y;
        return paint.shape(sector(cx, cy, sl.r0, sl.r1, sl.start, sl.sweep), st.fill, st.line, null, box);
      });
    return paint.group(shapes, ring[0]?.s.effects ?? null);
  });
}

/** A slice (or ring segment) from `start` clockwise by `sweep` degrees, 0 at twelve o'clock. */
function sector(cx: number, cy: number, r0: number, r1: number, start: number, sweep: number): string {
  const pt = (r: number, a: number): string => {
    const t = ((a - 90) * Math.PI) / 180;
    return `${cx + Math.cos(t) * r} ${cy + Math.sin(t) * r}`;
  };
  if (sweep >= 359.999) {
    const ring = `M${pt(r1, 0)}A${r1} ${r1} 0 1 1 ${pt(r1, 180)}A${r1} ${r1} 0 1 1 ${pt(r1, 360)}Z`;
    return r0 > 0 ? `${ring}M${pt(r0, 0)}A${r0} ${r0} 0 1 0 ${pt(r0, 180)}A${r0} ${r0} 0 1 0 ${pt(r0, 360)}Z` : ring;
  }
  const large = sweep > 180 ? 1 : 0;
  if (r0 <= 0) return `M${cx} ${cy}L${pt(r1, start)}A${r1} ${r1} 0 ${large} 1 ${pt(r1, start + sweep)}Z`;
  return `M${pt(r1, start)}A${r1} ${r1} 0 ${large} 1 ${pt(r1, start + sweep)}L${pt(r0, start + sweep)}A${r0} ${r0} 0 ${large} 0 ${pt(r0, start)}Z`;
}

// ── Data labels ─────────────────────────────────────────────────────────────

/**
 * Percent labels the way Office rounds them: to the format's precision, but so
 * that they add up to exactly 100% — the largest remainders round up (a 58.57%
 * slice reads 58% when 23% + 10% + 9% need the point).
 */
function percents(values: number[], format: string): number[] {
  const total = values.reduce((a, b) => a + b, 0);
  if (!total) return values.map(() => 0);
  const decimals = (format.split(".")[1]?.match(/[0#]/g) ?? []).length;
  const unit = Math.pow(10, -(decimals + 2));
  const exact = values.map((v) => v / total / unit);
  const floors = exact.map(Math.floor);
  let left = Math.round(1 / unit) - floors.reduce((a, b) => a + b, 0);
  const order = exact.map((e, i) => [e - floors[i]!, i] as const).sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  for (const [, i] of order) {
    if (left <= 0) break;
    floors[i] = floors[i]! + 1;
    left--;
  }
  return floors.map((f) => f * unit);
}

function labelText(l: ChartDataLabel, s: ChartSeries, i: number, chart: Chart, percent: number | null): string {
  const sep = l.separator ?? (SEPARATORS.decimal === "," ? "; " : ", ");
  const parts: string[] = [];
  if (l.series) parts.push(s.name);
  if (l.category) parts.push(formatValue(chart.categories.values[i] ?? i + 1, chart.categories.format, chart.date1904));
  const v = s.values.values[i] ?? null;
  if (l.value) parts.push(formatValue(v, l.format ?? s.values.format, chart.date1904));
  if (l.percent && percent !== null) parts.push(formatValue(percent, l.format && l.format.includes("%") ? l.format : "0%"));
  return parts.join(sep);
}

/** A data label's text, broken to a fifth of the chart's width like Office's. */
function labelBlock(l: ChartDataLabel, s: ChartSeries, i: number, chart: Chart, layout: Layout, percent: number | null): Block | null {
  const max = layout.chartW / 5;
  if (l.text) return l.text.some((p) => p.runs.some((r) => r.text)) ? block(l.text, max) : null;
  const text = labelText(l, s, i, chart, percent);
  return text ? plainBlock(text, l.font, max) : null;
}

/** A label centred on (cx, cy), with its legend key before it when asked. */
function placeLabel(b: Block, l: ChartDataLabel, fill: Fill | null, cx: number, cy: number, paint: Paint, k: string): ReactNode {
  if (!l.legendKey) return drawText(b, { x: cx - b.w / 2, y: cy - b.h / 2, w: b.w, h: b.h }, 0, k);
  const key = keySize(l.font);
  const gap = 0.39 * l.font.size * PT;
  const w = key + gap + b.w;
  const first = b.lines[0]?.runs[0]?.font ?? l.font;
  return (
    <g key={k}>
      {paint.shape({ x: cx - w / 2, y: cy - b.h / 2 + (lineHeight(first) - key) / 2, w: key, h: key }, fill, null, null)}
      {drawText(b, { x: cx - w / 2 + key + gap, y: cy - b.h / 2, w: b.w, h: b.h }, 0, `${k}t`)}
    </g>
  );
}

function drawDataLabels(chart: Chart, layout: Layout, paint: Paint, key: () => string): ReactNode[] {
  const out: ReactNode[] = [];
  const plot = layout.plot;
  for (const p of chart.plots) {
    if (p.kind === "pie") {
      const pie = layout.pie;
      if (!pie) continue;
      for (const ring of slices(p, pie)) {
        const s = ring[0]?.s;
        if (!s) continue;
        const pct = percents(ring.map((sl) => sl.value), s.labels.find((l) => l?.format?.includes("%"))?.format ?? "0%");
        for (const sl of ring) {
          const l = s.labels[sl.i];
          if (!l || sl.value <= 0) continue;
          const b = labelBlock(l, s, sl.i, chart, layout, sl.total ? (pct[sl.i] ?? 0) : null);
          if (!b) continue;
          // Inside the slice (the middle of a doughnut's ring), or past its rim.
          const outside = l.position === "outEnd";
          const mid = ((sl.start + sl.sweep / 2 - 90) * Math.PI) / 180;
          const rr = outside ? pie.r + b.h * 0.6 : sl.r0 > 0 ? (sl.r0 + sl.r1) / 2 : l.position === "ctr" ? sl.r1 / 2 : sl.r1 * 0.65;
          const cx = pie.cx + Math.cos(mid) * rr + (outside ? (Math.cos(mid) * b.w) / 2 : 0);
          const cy = pie.cy + Math.sin(mid) * rr;
          out.push(placeLabel(b, l, pointStyle(s, sl.i).fill, cx, cy, paint, key()));
        }
      }
      continue;
    }
    if (!plot || !plot.val?.scale) continue;
    const scale = plot.val.scale;
    const count = plot.cat?.count ?? 1;
    const stacked = p.kind !== "scatter" && (p.grouping === "stacked" || p.grouping === "percentStacked");
    const acc = Array.from({ length: count }, () => 0);
    const n = p.kind === "bar" && !stacked ? p.series.length : 1;
    const catLen = plot.cat?.band ?? (plot.horizontal ? plot.inner.h : plot.inner.w) / count;
    const overlap = p.kind === "bar" ? Math.max(-100, Math.min(100, stacked ? 100 : p.overlap)) / 100 : 0;
    const bw = p.kind === "bar" ? catLen / (n - (n - 1) * overlap + p.gapWidth / 100) : 0;
    const totals = Array.from({ length: count }, (_, i) => p.series.reduce((sum, s) => sum + Math.abs(num(s.values.values[i]) ?? 0), 0));
    p.series.forEach((s, k) => {
      const xs = p.kind === "scatter" ? xValuesOf(s) : null;
      s.values.values.forEach((raw, i) => {
        let v = num(raw);
        if (v === null) return;
        if (stacked && p.grouping === "percentStacked") v = totals[i] ? v / totals[i] : 0;
        const from = stacked ? acc[i]! : 0;
        const to = from + v;
        if (stacked) acc[i] = to;
        const l = s.labels[i];
        if (!l) return;
        const b = labelBlock(l, s, i, chart, layout, null);
        if (!b) return;
        let cx: number;
        let cy: number;
        const gap = 3 * PT;
        if (p.kind === "bar") {
          const slot = n === 1 ? 0 : k * bw * (1 - overlap) - ((n - 1) * bw * (1 - overlap)) / 2;
          const c = plot.horizontal ? plot.catPos(i) - slot : plot.catPos(i) + slot;
          const clamp = (x: number): number => Math.min(scale.max, Math.max(scale.min, x));
          const a = plot.valPos(clamp(from));
          const e = plot.valPos(clamp(to));
          const pos = l.position ?? (stacked ? "ctr" : "outEnd");
          const dir = Math.sign(e - a) || (plot.horizontal ? 1 : -1);
          const ext = plot.horizontal ? b.w : b.h;
          const along =
            pos === "ctr" ? (a + e) / 2 : pos === "inBase" ? a + dir * (ext / 2 + gap) : pos === "inEnd" ? e - dir * (ext / 2 + gap) : e + dir * (ext / 2 + gap);
          [cx, cy] = plot.horizontal ? [along, c] : [c, along];
        } else {
          const x = p.kind === "scatter" ? plot.catPos(xs?.[i] ?? i + 1) : plot.catPos(i);
          const y = plot.valPos(Math.min(scale.max, Math.max(scale.min, to)));
          const pos = l.position ?? (p.kind === "area" ? "ctr" : "r");
          const off = (s.marker ? (s.marker.size * PT) / 2 : 0) + gap;
          [cx, cy] = plot.horizontal ? [y, x] : [x, y];
          if (pos === "r") cx += off + b.w / 2;
          else if (pos === "l") cx -= off + b.w / 2;
          else if (pos === "t") cy -= off + b.h / 2;
          else if (pos === "b") cy += off + b.h / 2;
        }
        if (l.offset) {
          cx += l.offset.x * layout.chartW;
          cy += l.offset.y * layout.chartH;
        }
        const st = pointStyle(s, i);
        out.push(placeLabel(b, l, st.fill ?? st.line?.fill ?? null, cx, cy, paint, key()));
      });
    });
  }
  return out;
}

// ── Legend ──────────────────────────────────────────────────────────────────

function drawLegend(chart: Chart, legend: NonNullable<Layout["legend"]>, paint: Paint, key: () => string): ReactNode {
  const lg = chart.legend!;
  const font = lg.font;
  const em = font.size * PT;
  const out: ReactNode[] = [paint.box(lg, legend.rect)];
  const key0 = keySize(font);
  const kw = keyWidth(legend.entries, font);
  const rows = Math.ceil(legend.entries.length / legend.columns);
  const top0 = legend.rect.y + (legend.rect.h - rows * legend.rowH) / 2;
  let x = legend.rect.x + LEGEND_PAD_X;
  legend.entries.forEach((e, i) => {
    const col = i % legend.columns;
    const row = Math.floor(i / legend.columns);
    if (!legend.single) x = legend.rect.x + LEGEND_PAD_X + col * legend.colW;
    const cy = top0 + row * legend.rowH + legend.rowH / 2;
    const st = e.point !== null ? pointStyle(e.series, e.point) : { fill: e.series.fill, line: e.series.line, effects: e.series.effects, marker: e.series.marker };
    if (e.kind === "line") {
      if (st.line?.fill) out.push(paint.shape(`M${x} ${cy}H${x + kw}`, null, st.line, null));
      if (st.marker) out.push(drawMarker(st.marker, x + kw / 2, cy, paint, Math.min(st.marker.size, LEGEND_MARKER)));
    } else {
      out.push(paint.shape({ x, y: cy - key0 / 2, w: kw, h: key0 }, st.fill, st.line ? { ...st.line, width: Math.min(st.line.width, 9525) } : null, null));
    }
    const tx = x + kw + keyGap(legend.entries) * em;
    out.push(label(e.text, font, tx, cy - lineHeight(font) / 2, "start", key()));
    if (legend.single) x = tx + textWidth(e.text, font) + LEGEND_ENTRY_GAP * em;
  });
  return <g key={key()}>{out}</g>;
}
