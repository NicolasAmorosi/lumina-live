import type { Fill, Line } from "@shared/types/slide-model";
import { fillIn, readLine, themeStyle, type StyleContext } from "./style";
import { attr, child, parseXml, type XmlElement } from "./xml";

/**
 * Table styles (`a:tblStyle`): a table names one by GUID and switches parts of
 * it on (header row, banded rows, …). A deck saved by PowerPoint carries the
 * definitions it uses in `ppt/tableStyles.xml`; a built-in one it names
 * without defining comes from `resources/ooxml/tableStyles.xml`, PowerPoint's
 * own definitions harvested from decks it saved.
 */
export type TableStyleTable = ReadonlyMap<string, XmlElement>;

export function parseTableStyles(xml: XmlElement | string | null): TableStyleTable {
  const root = typeof xml === "string" ? parseXml(xml) : xml;
  const out = new Map<string, XmlElement>();
  for (const style of root?.children ?? []) {
    const id = attr(style, "styleId");
    if (style.name === "a:tblStyle" && id) out.set(id.toUpperCase(), style);
  }
  return out;
}

export type TableFlags = { firstRow: boolean; lastRow: boolean; firstCol: boolean; lastCol: boolean; bandRow: boolean; bandCol: boolean };

export type CellStyle = {
  fill: Fill | null | undefined;
  borders: { l?: Line | null; t?: Line | null; r?: Line | null; b?: Line | null };
  /** Run defaults for the cell's text: a `defRPr` built from `tcTxStyle`. */
  text: XmlElement | null;
};

type Region = { rows: [number, number]; cols: [number, number] };

/**
 * The style parts that apply to cell (r, c), least specific first, each with
 * the region it covers — a part's left/right/top/bottom borders are the
 * region's outer edges, its insideH/insideV the edges within it.
 */
function partsFor(r: number, c: number, rows: number, cols: number, f: TableFlags): [string, Region][] {
  const all: Region = { rows: [0, rows - 1], cols: [0, cols - 1] };
  const parts: [string, Region][] = [["a:wholeTbl", all]];
  const headerRows = f.firstRow ? 1 : 0;
  const headerCols = f.firstCol ? 1 : 0;
  const inBodyRow = r >= headerRows && !(f.lastRow && r === rows - 1);
  const inBodyCol = c >= headerCols && !(f.lastCol && c === cols - 1);
  if (f.bandRow && inBodyRow) parts.push([(r - headerRows) % 2 === 0 ? "a:band1H" : "a:band2H", { rows: [r, r], cols: all.cols }]);
  if (f.bandCol && inBodyCol) parts.push([(c - headerCols) % 2 === 0 ? "a:band1V" : "a:band2V", { rows: all.rows, cols: [c, c] }]);
  if (f.lastCol && c === cols - 1) parts.push(["a:lastCol", { rows: all.rows, cols: [c, c] }]);
  if (f.firstCol && c === 0) parts.push(["a:firstCol", { rows: all.rows, cols: [0, 0] }]);
  if (f.lastRow && r === rows - 1) parts.push(["a:lastRow", { rows: [r, r], cols: all.cols }]);
  if (f.firstRow && r === 0) parts.push(["a:firstRow", { rows: [0, 0], cols: all.cols }]);
  const one: Region = { rows: [r, r], cols: [c, c] };
  if (f.lastRow && f.lastCol && r === rows - 1 && c === cols - 1) parts.push(["a:seCell", one]);
  if (f.lastRow && f.firstCol && r === rows - 1 && c === 0) parts.push(["a:swCell", one]);
  if (f.firstRow && f.lastCol && r === 0 && c === cols - 1) parts.push(["a:neCell", one]);
  if (f.firstRow && f.firstCol && r === 0 && c === 0) parts.push(["a:nwCell", one]);
  return parts;
}

export function cellStyle(style: XmlElement, r: number, c: number, rows: number, cols: number, flags: TableFlags, ctx: StyleContext): CellStyle {
  const out: CellStyle = { fill: undefined, borders: {}, text: null };
  const textAttrs: Record<string, string> = {};
  let textChildren: XmlElement[] = [];
  for (const [name, region] of partsFor(r, c, rows, cols, flags)) {
    const part = child(style, name);
    if (!part) continue;
    const tcStyle = child(part, "a:tcStyle");
    const fill = child(tcStyle, "a:fill");
    const fillRef = child(tcStyle, "a:fillRef");
    if (fill) out.fill = fillIn(fill, ctx) ?? null;
    else if (fillRef) out.fill = themeStyle(fillRef, "fill", ctx).fill ?? null;

    const bdr = child(tcStyle, "a:tcBdr");
    const edge = (outer: string, inner: string, isOuter: boolean): Line | null | undefined => {
      const side = child(bdr, isOuter ? outer : inner);
      if (!side) return undefined;
      const ln = child(side, "a:ln");
      if (ln) return readLine(ln, ctx, null);
      const ref = child(side, "a:lnRef");
      return ref ? (themeStyle(ref, "line", ctx).line ?? null) : undefined;
    };
    const set = (key: keyof CellStyle["borders"], value: Line | null | undefined): void => {
      if (value !== undefined) out.borders[key] = value;
    };
    set("l", edge("a:left", "a:insideV", c === region.cols[0]));
    set("r", edge("a:right", "a:insideV", c === region.cols[1]));
    set("t", edge("a:top", "a:insideH", r === region.rows[0]));
    set("b", edge("a:bottom", "a:insideH", r === region.rows[1]));

    const tx = child(part, "a:tcTxStyle");
    if (tx) {
      for (const key of ["b", "i"] as const) {
        const v = attr(tx, key);
        if (v !== null) textAttrs[key] = v === "on" ? "1" : v === "off" ? "0" : v;
      }
      // A colour child sets the text colour; a fontRef its face (and a colour
      // of its own, which the explicit one beats).
      const color = tx.children.find((k) => k.name !== "a:fontRef" && k.name !== "a:font");
      const fontRef = child(tx, "a:fontRef");
      const next: XmlElement[] = [];
      if (fontRef) next.push({ name: "a:latin", attrs: { typeface: attr(fontRef, "idx") === "major" ? "+mj-lt" : "+mn-lt" }, children: [], text: "" });
      if (color) next.push({ name: "a:solidFill", attrs: {}, children: [color], text: "" });
      else if (fontRef?.children[0]) next.push({ name: "a:solidFill", attrs: {}, children: [fontRef.children[0]], text: "" });
      if (next.length) textChildren = [...textChildren.filter((k) => !next.some((n) => n.name === k.name)), ...next];
    }
  }
  if (Object.keys(textAttrs).length || textChildren.length) {
    out.text = { name: "a:defRPr", attrs: textAttrs, children: textChildren, text: "" };
  }
  return out;
}

/** The table background (`a:tblBg`), painted under every cell. */
export function tableBackground(style: XmlElement, ctx: StyleContext): Fill | null {
  const bg = child(style, "a:tblBg");
  if (!bg) return null;
  const ref = child(bg, "a:fillRef");
  if (ref) return themeStyle(ref, "fill", ctx).fill ?? null;
  return fillIn(child(bg, "a:fill") ?? bg, ctx) ?? null;
}
