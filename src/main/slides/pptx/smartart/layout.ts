import { typeMatches, type Box, type Constraint, type LayoutNode } from "./model";

/**
 * Sizes and places every layout node, top down: the constraints give each
 * child its PREFERRED size (often relative to its parent — a process node as
 * wide as the whole diagram), its parent's algorithm fits the children into
 * the box it was given (a row of five such nodes shrinks to fit), and each
 * child's own subtree is then worked out against the box it actually got.
 *
 * Units, measured against PowerPoint's own drawings: lengths in a constraint's
 * `val` are millimetres; a length that refers to a font size takes the size's
 * points as millimetres — except a text margin, which takes them as points
 * (`lMarg = 0.3 × 65 pt` is a 19.5 pt inset, and `h = 0.82 × 30 pt` is
 * 24.6 mm tall).
 */

const MM = 36000;
const PT = 12700;
const FONT = new Set(["primFontSz", "secFontSz"]);
const MARGIN = new Set(["lMarg", "rMarg", "tMarg", "bMarg", "begMarg", "endMarg"]);
const UNITLESS = new Set(["alignOff", "pyraAcctRatio", "wArH", "hArH", "none"]);
/** Constraint types a bare `<constr type="l"/>` sets to zero. A bare `w`/`h`
 *  does too, but only where nothing sized the node yet (it often just names
 *  the size a rule may grow). */
const ZERO_WHEN_BARE = new Set(["l", "t", "r", "b", "ctrX", "ctrY", "lMarg", "rMarg", "tMarg", "bMarg", "begPad", "endPad", "connDist", "sp", "sibSp", "secSibSp", "alignOff"]);

type Kind = "font" | "margin" | "length" | "none";
const kindOf = (type: string): Kind => (FONT.has(type) ? "font" : MARGIN.has(type) ? "margin" : UNITLESS.has(type) ? "none" : "length");

type Relative = { owner: LayoutNode; refType: string; fact: number };

export type LayoutState = {
  /** Fitted font sizes by layout node name (the previous pass's text fit). */
  fitted: Map<string, number>;
  /** Margins that follow a font size: node → margin type → factor of the size. */
  marginFactors: Map<LayoutNode, Map<string, number>>;
  /** A node's font size as its constraints give it, before the fit. */
  rawPrim: Map<LayoutNode, number>;
  /** Sizes given as a fraction of an ancestor's: they follow the box that
   *  ancestor actually gets, not the one it asked for. */
  relative: Map<LayoutNode, Map<string, Relative>>;
  /** `op="equ"` with no value: the size is whatever its group's other members get. */
  equal: Map<LayoutNode, Map<string, { owner: LayoutNode; c: Constraint }>>;
  /** Some length follows a font size: shrinking the text shrinks the diagram. */
  fontLengths: boolean;
  done: Set<LayoutNode>;
  busy: Set<LayoutNode>;
};

export function newState(fitted: Map<string, number>): LayoutState {
  return { fitted, marginFactors: new Map(), rawPrim: new Map(), relative: new Map(), equal: new Map(), fontLengths: false, done: new Set(), busy: new Set() };
}

function ancestors(n: LayoutNode): LayoutNode[] {
  const out: LayoutNode[] = [];
  for (let a = n.parent; a; a = a.parent) out.unshift(a);
  return out;
}

function targets(c: Constraint, owner: LayoutNode, n: LayoutNode): boolean {
  if (c.for === "self") return owner === n;
  if (c.for === "ch" && n.parent !== owner) return false;
  if (c.forName && c.forName !== n.name) return false;
  if (c.ptType && !typeMatches(n.point, c.ptType)) return false;
  return c.for === "ch" || c.for === "des";
}

/** A node's preferred properties: its ancestors' constraints on it, farthest
 *  first, then its own. */
export function props(n: LayoutNode, s: LayoutState): Map<string, number> {
  if (s.done.has(n) || s.busy.has(n)) return n.props;
  s.busy.add(n);
  for (const a of ancestors(n)) {
    props(a, s);
    for (const c of a.constraints) if (c.for !== "self" && targets(c, a, n)) apply(c, a, n, s);
  }
  for (const c of n.constraints) if (c.for === "self") apply(c, n, n, s);
  const fitted = s.fitted.get(n.name);
  const raw = s.rawPrim.get(n);
  const sec = n.props.get("secFontSz");
  if (fitted !== undefined && raw && sec !== undefined) n.props.set("secFontSz", (sec * fitted) / raw);
  for (const [k, f] of [["w", n.scale.x], ["h", n.scale.y]] as const) {
    const v = n.props.get(k);
    if (f !== 1 && v !== undefined) n.props.set(k, v * f);
  }
  s.busy.delete(n);
  s.done.add(n);
  return n.props;
}

function refNode(c: Constraint, owner: LayoutNode, target: LayoutNode): LayoutNode | null {
  if (c.refFor === "self") return owner;
  const matches = (n: LayoutNode): boolean =>
    (!c.refForName || n.name === c.refForName) && (!c.refPtType || typeMatches(n.point, c.refPtType));
  const pool: LayoutNode[] = [];
  if (c.refFor === "ch") pool.push(...owner.children);
  else {
    const walk = (n: LayoutNode): void => {
      for (const ch of n.children) {
        pool.push(ch);
        walk(ch);
      }
    };
    walk(owner);
  }
  if (matches(target) && pool.includes(target)) return target;
  return pool.find(matches) ?? null;
}

function value(n: LayoutNode, type: string, s: LayoutState): number | undefined {
  const p = props(n, s);
  const v = p.get(type);
  if (v !== undefined) return v;
  if (type === "primFontSz") return s.fitted.get(n.name) ?? 65;
  for (const axis of AXES) {
    const i = (axis as readonly string[]).indexOf(type);
    if (i >= 0) return spanOf(p, axis)?.[i];
  }
  return undefined;
}

/** An edge, the far edge, the size and the centre along one axis: any two
 *  give the others. */
const AXES = [["l", "r", "w", "ctrX"], ["t", "b", "h", "ctrY"]] as const;

function spanOf(p: Map<string, number>, [lo, hi, size, ctr]: readonly string[]): [number, number, number, number] | undefined {
  const g = (k: string): number | undefined => finite(p.get(k));
  let l = g(lo!), r = g(hi!), w = g(size!), m = g(ctr!);
  if (w === undefined) w = l !== undefined && r !== undefined ? r - l : m !== undefined && l !== undefined ? 2 * (m - l) : m !== undefined && r !== undefined ? 2 * (r - m) : undefined;
  if (w === undefined) return undefined;
  if (l === undefined) l = m !== undefined ? m - w / 2 : r !== undefined ? r - w : undefined;
  if (l === undefined) return undefined;
  r ??= l + w;
  m ??= l + w / 2;
  return [l, r, w, m];
}

function apply(c: Constraint, owner: LayoutNode, n: LayoutNode, s: LayoutState): void {
  const kind = kindOf(c.type);
  let v: number | undefined;
  if (c.refType && c.refType !== "none") {
    const ref = refNode(c, owner, n);
    const rv = ref && ref !== n ? value(ref, c.refType, s) : ref === n ? n.props.get(c.refType) ?? value(n, c.refType, s) : undefined;
    if (rv === undefined || !Number.isFinite(rv)) return;
    const from = kindOf(c.refType);
    let unit = 1;
    if (from === "font" && kind === "margin") unit = PT;
    else if (from === "font" && kind === "length") unit = MM;
    else if (from !== "font" && from !== "none" && kind === "font") unit = 1 / PT;
    v = rv * c.fact * unit;
    if (from === "font" && kind === "length") s.fontLengths = true;
    if (from === "font" && kind === "margin") {
      const m = s.marginFactors.get(n) ?? new Map<string, number>();
      m.set(c.type, c.fact);
      s.marginFactors.set(n, m);
    }
  } else if (c.val !== null) {
    if (!Number.isFinite(c.val)) return;
    v = c.val * (kind === "length" || kind === "margin" ? MM : 1);
  } else if (c.op === "equ") {
    const eq = s.equal.get(n) ?? new Map<string, { owner: LayoutNode; c: Constraint }>();
    eq.set(c.type, { owner, c });
    s.equal.set(n, eq);
    return;
  } else if (ZERO_WHEN_BARE.has(c.type) || ((c.type === "w" || c.type === "h") && !n.props.has(c.type))) {
    // A bare `w`/`h` is zero only where nothing sized the node yet.
    if (c.op !== "none") return;
    v = 0;
  } else return;
  const rel = s.relative.get(n) ?? new Map<string, Relative>();
  if (c.refFor === "self" && owner !== n && (c.refType === "w" || c.refType === "h") && (c.type === "w" || c.type === "h") && c.op === "none") {
    rel.set(c.type, { owner, refType: c.refType, fact: c.fact });
    s.relative.set(n, rel);
  } else if (c.op === "none") rel.delete(c.type);
  if (c.type === "primFontSz") {
    // The text fit of the previous round wins over the layout's maximum.
    s.rawPrim.set(n, v);
    v = s.fitted.get(n.name) ?? v;
  }
  // An inequality against the node's own container holds (vList3's picture
  // no taller than its row). One against another node is a bound for the
  // rules to work within, and PowerPoint keeps what an equality said: list1's
  // `negativeSpace` stays at half the title's height, not the `lte`'s 82 %.
  // Either stands in when nothing else gave a value.
  // ponytail: no rule solver — rules only shrink a row's named children and
  // grow a composite child into free room; PowerPoint relaxes them in order.
  const old = n.props.get(c.type);
  if ((c.op === "lte" || c.op === "gte") && old !== undefined) {
    if (c.refFor === "self" && c.refType && c.refType !== "none") n.props.set(c.type, c.op === "lte" ? Math.min(old, v) : Math.max(old, v));
    return;
  }
  n.props.set(c.type, v);
}

/** Places `n` in `box` and its subtree after it. */
export function place(n: LayoutNode, box: Box, s: LayoutState): void {
  n.box = box;
  if (n.children.length === 0) return;
  settle(n, box, s);
  switch (n.alg) {
    case "lin":
      return linear(n, box, s);
    case "snake":
      return snake(n, box, s);
    case "cycle":
      return cycle(n, box, s);
    case "hierChild":
    case "hierRoot":
      return hierarchy(n, box, s);
    case "pyra":
      return pyramid(n, box);
    default:
      return composite(n, box, s);
  }
}

/**
 * From here on a node is the size its parent gave it, and its subtree's
 * constraints are worked out again against that: a process step's title is
 * 83 % of the step's ACTUAL width, not of the width it asked for (which may be
 * the whole diagram's, or `h = 1000 × w`).
 */
function settle(n: LayoutNode, box: Box, s: LayoutState): void {
  props(n, s);
  n.props.set("w", box.w);
  n.props.set("h", box.h);
  const forget = (x: LayoutNode): void => {
    for (const c of x.children) {
      s.done.delete(c);
      c.props = new Map();
      s.relative.delete(c);
      s.equal.delete(c);
      s.marginFactors.delete(c);
      s.rawPrim.delete(c);
      forget(c);
    }
  };
  forget(n);
}

const isSpace = (n: LayoutNode): boolean => n.alg === "sp" && !visibleShape(n);
const isConn = (n: LayoutNode): boolean => n.alg === "conn" || shapeType(n) === "conn";

export function shapeType(n: LayoutNode): string {
  const t = n.shape?.attrs["type"] ?? "";
  return t === "none" ? "" : t;
}

export function visibleShape(n: LayoutNode): boolean {
  return shapeType(n) !== "" && n.shape?.attrs["hideGeom"] !== "1" && n.shape?.attrs["hideGeom"] !== "true";
}

/** Children where their constraints put them, in the composite's own
 *  (settled) coordinates; a child with no size fills it. */
function composite(n: LayoutNode, box: Box, s: LayoutState): void {
  let frame = box;
  const ar = Number(n.params.get("ar") ?? NaN);
  if (ar > 0) {
    // The composite keeps its aspect ratio (width over height), centred.
    const w = Math.min(box.w, box.h * ar);
    const h = w / ar;
    frame = { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h };
    n.box = frame;
    settle(n, frame, s);
  }
  const boxes: { c: LayoutNode; b: Box }[] = [];
  for (const c of n.children) {
    const p = props(c, s);
    const get = (k: string): number | undefined => {
      const v = p.get(k);
      return v !== undefined && Number.isFinite(v) ? v : undefined;
    };
    const span = (size: string, lo: string, hi: string, ctr: string, full: number): [number, number] => {
      const l = get(lo), r = get(hi), m = get(ctr);
      let w = get(size);
      if (w === undefined) w = l !== undefined && r !== undefined ? r - l : m !== undefined && l !== undefined ? 2 * (m - l) : m !== undefined && r !== undefined ? 2 * (r - m) : full;
      w += get(`${size}Off`) ?? 0;
      const x = (l !== undefined ? l : m !== undefined ? m - w / 2 : r !== undefined ? r - w : 0) + (get(`${lo}Off`) ?? 0);
      return [x, w];
    };
    const [x, w] = span("w", "l", "r", "ctrX", frame.w);
    const [y, h] = span("h", "t", "b", "ctrY", frame.h);
    boxes.push({ c, b: { x: frame.x + x, y: frame.y + y, w: Math.max(0, w), h: Math.max(0, h) } });
  }
  // A child its rules let grow taller (`rule type="h" val="INF"`) takes the
  // free room under it: a list's body runs to the bottom of its column.
  for (const { c, b } of boxes) {
    if (!c.rules.some((r) => r.for === "self" && r.type === "h" && (r.val === null || r.val > b.h))) continue;
    const bottom = b.y + b.h;
    const below = boxes.filter((o) => o.c !== c && o.b.y >= bottom - 1 && o.b.x < b.x + b.w && o.b.x + o.b.w > b.x).map((o) => o.b.y);
    const limit = Math.min(frame.y + frame.h, ...below);
    if (limit > bottom) b.h = limit - b.y;
  }
  for (const { c, b } of boxes) place(c, b, s);
}

type Dir = { horizontal: boolean; reverse: boolean };
function direction(v: string | undefined): Dir {
  return { horizontal: v !== "fromT" && v !== "fromB", reverse: v === "fromR" || v === "fromB" };
}

/** A row (or column) of children at their preferred sizes, shrunk along the
 *  row when it doesn't fit, and as a whole when a child is too tall for it. */
function linear(n: LayoutNode, box: Box, s: LayoutState): void {
  const dir = direction(n.params.get("linDir"));
  const main = dir.horizontal ? "w" : "h";
  const cross = dir.horizontal ? "h" : "w";
  const avail = dir.horizontal ? box.w : box.h;
  const availCross = dir.horizontal ? box.h : box.w;
  const kids = n.children;
  const gap = finite(props(n, s).get("sp")) ?? 0;
  const known = kids.map((c) => (empty(c) ? 0 : size(c, main, s)));
  const unknown = known.filter((v) => v === undefined).length;
  const knownSum = known.reduce<number>((a, v) => a + (v ?? 0), 0);
  const share = unknown > 0 ? Math.max(0, avail - knownSum - gap * (kids.length - 1)) / unknown : 0;
  const sizes = kids.map((c, i) => {
    if (empty(c)) return { m: 0, c: 0, followsMain: false, fill: false };
    const m = known[i] ?? share;
    // A cross size its own rules let grow or shrink (`h = 1000 × w` with
    // `rule h INF`) is whatever the row has.
    const flexible = c.rules.some((r) => r.for === "self" && r.type === cross);
    const crossPref = flexible ? Math.min(size(c, cross, s) ?? availCross, availCross) : size(c, cross, s);
    return { m, c: crossPref ?? availCross, followsMain: !flexible && crossFollowsMain(c, cross, main), fill: crossPref === undefined };
  });
  // The rules name the children that give way (`rule type="w" forName="linV"`),
  // and what is sized after them follows; the rest keep their size. With no
  // such rule, everything shrinks alike.
  const named = new Set(n.rules.filter((r) => r.type === main && r.for === "ch" && r.forName).map((r) => r.forName!));
  const shrinks = kids.map((c) => named.size === 0 || named.has(c.name) || dependsOn(c, main, named));
  const total = sizes.reduce((a, v) => a + v.m, 0) + gap * (kids.length - 1);
  const fixed = sizes.reduce((a, v, i) => a + (shrinks[i] ? 0 : v.m), 0);
  const giving = total - fixed;
  const k = total > avail && giving > 0 ? Math.max(0, (avail - fixed) / giving) : 1;
  let g = gap * k;
  sizes.forEach((v, i) => {
    if (!shrinks[i]) return;
    v.m *= k;
    if (v.followsMain) v.c *= k;
  });
  // Too tall for the row: what is shaped by its width shrinks whole (the row
  // with it); anything else is just cut to the row.
  const maxCross = Math.max(0, ...sizes.filter((v) => v.followsMain).map((v) => v.c));
  if (maxCross > availCross && maxCross > 0) {
    const f = availCross / maxCross;
    for (const v of sizes) {
      v.m *= f;
      v.c = v.fill ? availCross : v.c * f;
    }
    g *= f;
  }
  for (const v of sizes) v.c = Math.min(v.c, availCross);
  const used = sizes.reduce((a, v) => a + v.m, 0) + g * (kids.length - 1);
  const align = n.params.get(dir.horizontal ? "horzAlign" : "vertAlign") ?? "none";
  let pos = align === "l" || align === "t" || align === "none" ? 0 : align === "r" || align === "b" ? avail - used : (avail - used) / 2;
  if (dir.reverse) pos = avail - pos;
  const nodeAlign = n.params.get(dir.horizontal ? "nodeVertAlign" : "nodeHorzAlign") ?? "mid";
  kids.forEach((c, i) => {
    const v = sizes[i]!;
    const start = dir.reverse ? pos - v.m : pos;
    const off = nodeAlign === "t" || nodeAlign === "l" ? 0 : nodeAlign === "b" || nodeAlign === "r" ? availCross - v.c : (availCross - v.c) / 2;
    const b: Box = dir.horizontal
      ? { x: box.x + start, y: box.y + off, w: v.m, h: v.c }
      : { x: box.x + off, y: box.y + start, w: v.c, h: v.m };
    if (isConn(c)) c.rot = dir.horizontal ? (dir.reverse ? 180 : 0) : dir.reverse ? 270 : 90;
    pos += (dir.reverse ? -1 : 1) * (v.m + g);
    place(c, b, s);
  });
}

/** Is a child's main size a fraction of a child that gives way? */
function dependsOn(c: LayoutNode, main: string, names: Set<string>): boolean {
  const parent = c.parent;
  return !!parent && parent.constraints.some((k) => k.type === main && targets(k, parent, c) && k.refType === main && k.refForName !== null && names.has(k.refForName));
}

/** Does a child's cross size follow a main-axis size (`h` of `w`)? Then it
 *  shrinks with the row. */
function crossFollowsMain(c: LayoutNode, cross: string, main: string): boolean {
  for (let a: LayoutNode | null = c.parent; a; a = a.parent) {
    for (const k of a.constraints) if (k.type === cross && k.refType === main && k.for !== "self" && targets(k, a, c)) return true;
  }
  return c.constraints.some((k) => k.for === "self" && k.type === cross && k.refType === main);
}

/** A child's size: against its ancestor's actual box when it is a fraction of
 *  it; else what its constraints say; else its equality group's; else, for a
 *  row or column, what its own children add up to. */
function size(c: LayoutNode, type: string, s: LayoutState, seen = new Set<LayoutNode>()): number | undefined {
  if (seen.has(c)) return undefined;
  seen.add(c);
  const rel = s.relative.get(c)?.get(type);
  const box = rel?.owner.box;
  if (rel && box) return rel.fact * (rel.refType === "w" ? box.w : box.h) * (type === "w" ? c.scale.x : c.scale.y);
  const own = finite(props(c, s).get(type));
  if (own !== undefined) return own;
  const eq = s.equal.get(c)?.get(type);
  if (eq) {
    const others: LayoutNode[] = [];
    const walk = (x: LayoutNode): void => {
      for (const ch of x.children) {
        if (ch !== c && targets(eq.c, eq.owner, ch)) others.push(ch);
        walk(ch);
      }
    };
    walk(eq.owner);
    for (const o of others) {
      const v = finite(props(o, s).get(type));
      if (v !== undefined) return v;
    }
  }
  return natural(c, type, s, seen);
}

/** A row's or column's own extent, from its children. */
function natural(n: LayoutNode, type: string, s: LayoutState, seen: Set<LayoutNode>): number | undefined {
  if (n.alg !== "lin") return undefined;
  const dir = direction(n.params.get("linDir"));
  const along = (type === "w") === dir.horizontal;
  const kids = n.children.filter((c) => !empty(c));
  const sizes = kids.map((c) => size(c, type, s, new Set(seen)) ?? 0);
  if (sizes.length === 0) return 0;
  const gap = finite(props(n, s).get("sp")) ?? 0;
  return along ? sizes.reduce((a, v) => a + v, 0) + gap * (sizes.length - 1) : Math.max(...sizes);
}

/** A container with nothing to draw in it — no shape, no text, no children
 *  that draw — takes no room. (Spacers do: that's what they are for.) */
export function empty(n: LayoutNode): boolean {
  if (n.alg === "sp" || visibleShape(n)) return false;
  if (n.presOf && Object.keys(n.presOf.attrs).length > 0) return false;
  return n.children.every(empty);
}

const finite = (v: number | undefined): number | undefined => (v !== undefined && Number.isFinite(v) ? v : undefined);

/** A grid filled row by row, as many columns as make the nodes largest. */
function snake(n: LayoutNode, box: Box, s: LayoutState): void {
  const cells = n.children.filter((c) => !isSpace(c) && !isConn(c));
  if (cells.length === 0) return;
  const w0 = size(cells[0]!, "w", s) ?? box.w;
  const h0 = size(cells[0]!, "h", s) ?? w0 * 0.6;
  const sp = finite(props(n, s).get("sp")) ?? 0;
  const count = cells.length;
  // `off="off"`: each row starts a cell further along (a staircase).
  const stair = n.params.get("off") === "off";
  const fixed = n.params.get("bkpt") === "fixed" ? Math.max(1, Number(n.params.get("bkPtFixedVal") ?? 1) || 1) : 0;
  const extent = (cols: number): { w: number; h: number } => {
    const rows = Math.ceil(count / cols);
    return { w: (cols + (stair ? rows - 1 : 0)) * w0 + (cols - 1) * Math.max(0, sp), h: rows * h0 + (rows - 1) * sp };
  };
  let best = { cols: Math.min(fixed || 1, count), k: 0 };
  for (let cols = fixed ? best.cols : 1; cols <= (fixed ? best.cols : count); cols++) {
    const e = extent(cols);
    const k = Math.min(box.w / e.w, box.h / e.h);
    if (k > best.k * 1.0001) best = { cols, k };
  }
  const { cols, k } = best;
  const rows = Math.ceil(count / cols);
  const w = w0 * k, h = h0 * k, g = sp * k;
  const gridW = extent(cols).w * k;
  const gridH = extent(cols).h * k;
  const x0 = box.x + (box.w - gridW) / 2;
  const y0 = box.y + (box.h - gridH) / 2;
  const gr = n.params.get("grDir") ?? "tL";
  const byCol = n.params.get("flowDir") === "col";
  const zigzag = n.params.get("contDir") === "revDir";
  const center = (n.params.get("off") ?? "ctr") === "ctr";
  cells.forEach((c, i) => {
    let row = byCol ? i % rows : Math.floor(i / cols);
    let col = byCol ? Math.floor(i / rows) : i % cols;
    const inLine = byCol ? (col === Math.floor((count - 1) / rows) ? count - col * rows : rows) : row === rows - 1 ? count - row * cols : cols;
    if (zigzag && (byCol ? col : row) % 2 === 1) {
      if (byCol) row = rows - 1 - row;
      else col = cols - 1 - col;
    }
    let x = col * (w + Math.max(0, g)) + (stair ? row * w : 0);
    let y = row * (h + g);
    if (center && !byCol && inLine < cols) x += ((cols - inLine) * (w + g)) / 2;
    if (center && byCol && inLine < rows) y += ((rows - inLine) * (h + g)) / 2;
    if (gr === "tR" || gr === "bR") x = gridW - x - w;
    if (gr === "bL" || gr === "bR") y = gridH - y - h;
    place(c, { x: x0 + x, y: y0 + y, w, h }, s);
  });
  // Connectors between consecutive cells, along the line between them.
  n.children.forEach((c, i) => {
    if (!isConn(c)) return;
    const a = n.children.slice(0, i).reverse().find((x) => cells.includes(x));
    const b = n.children.slice(i + 1).find((x) => cells.includes(x));
    if (a?.box && b?.box) between(c, a.box, b.box, s);
  });
}

/** Nodes evenly around a circle as large as keeps them `sibSp` apart (a
 *  `fNode` map puts the first in the middle); connectors in the gap between
 *  each node and the next. */
function cycle(n: LayoutNode, box: Box, s: LayoutState): void {
  const st = Number(n.params.get("stAng") ?? 0);
  const span = Number(n.params.get("spanAng") ?? 360);
  const centerFirst = n.params.get("ctrShpMap") === "fNode";
  const along = n.params.get("rotPath") === "alongPath";
  const nodes = n.children.filter((c) => !isSpace(c) && !isConn(c));
  const conns = n.children.filter(isConn);
  const center = centerFirst ? nodes.shift() : undefined;
  const count = nodes.length;
  const p0 = nodes[0] ? props(nodes[0], s) : center ? props(center, s) : null;
  if (!p0) return;
  let w0 = finite(p0.get("w")) ?? box.w / 4;
  let h0 = finite(p0.get("h")) ?? w0;
  const sib = finite(props(n, s).get("sibSp")) ?? 0;
  const full = Math.abs(span) >= 360;
  const stepAng = count > 0 ? span / (full ? count : Math.max(1, count - 1)) : 0;
  // Radius that keeps neighbours `sibSp` apart, in units of the node size.
  const chord = Math.max(w0, h0) + sib;
  const half = Math.abs((stepAng * Math.PI) / 360);
  // A `diam` constraint names the circle outright (arrow5: 1.1 node widths;
  // cycle7: the whole width), and nodes too big to stay `sibSp` apart on it
  // shrink to fit.
  const diam = finite(props(n, s).get("diam"));
  let r = count > 1 ? chord / (2 * Math.max(Math.sin(half), 1e-3)) : 0;
  if (diam !== undefined && diam > 0 && count > 1) {
    const fit = Math.min(1, (diam * Math.sin(half)) / chord);
    w0 *= fit;
    h0 *= fit;
    r = diam / 2;
  }
  let cw = 0, ch = 0;
  if (center) {
    const pc = props(center, s);
    cw = finite(pc.get("w")) ?? w0 * 1.5;
    ch = finite(pc.get("h")) ?? cw;
    // Satellites sit on the centre node's rim.
    r = Math.max(r, count > 0 ? Math.max(cw, ch) / 2 : 0);
  }
  // Where everything goes around (0, 0) at this size; then the whole is
  // scaled to fill the box and centred on it — three nodes make a triangle,
  // not a circle's worth of empty space.
  const angle = (i: number): number => st + i * stepAng;
  const spots = nodes.map((_, i) => {
    const a = (angle(i) * Math.PI) / 180;
    return { x: r * Math.sin(a), y: -r * Math.cos(a) };
  });
  const x0 = Math.min(-cw / 2, ...spots.map((p) => p.x - w0 / 2)), x1 = Math.max(cw / 2, ...spots.map((p) => p.x + w0 / 2));
  const y0 = Math.min(-ch / 2, ...spots.map((p) => p.y - h0 / 2)), y1 = Math.max(ch / 2, ...spots.map((p) => p.y + h0 / 2));
  const k = Math.min(box.w / Math.max(1, x1 - x0), box.h / Math.max(1, y1 - y0));
  const ox = box.x + (box.w - (x1 - x0) * k) / 2 - x0 * k;
  const oy = box.y + (box.h - (y1 - y0) * k) / 2 - y0 * k;
  if (center) place(center, { x: ox - (cw * k) / 2, y: oy - (ch * k) / 2, w: cw * k, h: ch * k }, s);
  nodes.forEach((c, i) => {
    if (along) c.rot = angle(i);
    place(c, { x: ox + spots[i]!.x * k - (w0 * k) / 2, y: oy + spots[i]!.y * k - (h0 * k) / 2, w: w0 * k, h: h0 * k }, s);
  });
  // Each connector between the node before it and the next, round the cycle.
  conns.forEach((c, i) => {
    const a = nodes[i % Math.max(1, count)]?.box;
    const b = nodes[(i + 1) % Math.max(1, count)]?.box;
    if (count >= 2 && a && b) between(c, a, b, s, k);
  });
}

/** A connector laid along the gap between two boxes. */
export function between(c: LayoutNode, a: Box, b: Box, s: LayoutState, k = 1): void {
  const ax = a.x + a.w / 2, ay = a.y + a.h / 2, bx = b.x + b.w / 2, by = b.y + b.h / 2;
  const dx = bx - ax, dy = by - ay;
  const dist = Math.hypot(dx, dy);
  if (dist === 0) return;
  // How far each box reaches toward the other along the centre line.
  const reach = (box: Box): number => {
    const tx = dx === 0 ? Infinity : box.w / 2 / Math.abs(dx / dist);
    const ty = dy === 0 ? Infinity : box.h / 2 / Math.abs(dy / dist);
    return Math.min(tx, ty);
  };
  const gapStart = reach(a), gapEnd = dist - reach(b);
  const gap = Math.max(0, gapEnd - gapStart);
  const p = props(c, s);
  const pw = finite(p.get("w")), ph = finite(p.get("h"));
  const len = Math.min(pw !== undefined ? pw * k : gap * 0.6, gap * 0.8) || gap * 0.6;
  const thick = Math.min(ph !== undefined ? ph * k : len * 0.6, len * 1.4);
  const mid = (gapStart + gapEnd) / 2;
  const mx = ax + (dx / dist) * mid, my = ay + (dy / dist) * mid;
  c.rot = (Math.atan2(dy, dx) * 180) / Math.PI;
  c.box = { x: mx - len / 2, y: my - thick / 2, w: len, h: thick };
}

/**
 * An organisation chart: a `hierRoot` puts its own box on top, its assistants
 * below and to the left of its stem, and its children's block under both —
 * centred, or hanging from one side for an `l`/`r` branch (`hierChild` with
 * `linDir="fromT"`). A `hierChild` lays its roots side by side, top-aligned,
 * or stacked. Laid out at the preferred sizes, then scaled into the box.
 */
function hierarchy(n: LayoutNode, box: Box, s: LayoutState): void {
  const ext = measure(n, s);
  const k = Math.min(ext.w > 0 ? box.w / ext.w : 1, ext.h > 0 ? box.h / ext.h : 1);
  arrange(n, box.x + (box.w - ext.w * k) / 2, box.y + (box.h - ext.h * k) / 2, k, s);
}

/** A hierarchy node's size, and where its parts go in it (preferred units). */
type Tree = { w: number; h: number; parts: { node: LayoutNode; x: number; y: number }[] };
const trees = new WeakMap<LayoutNode, Tree>();

const stacked = (n: LayoutNode): boolean => n.params.get("linDir") === "fromT" || n.params.get("secLinDir") === "fromT";

function measure(n: LayoutNode, s: LayoutState): Tree {
  const p = props(n, s);
  const parts: Tree["parts"] = [];
  let tree: Tree;
  if (n.alg === "hierRoot") {
    const root = n.children.find((c) => c.alg !== "hierChild" && !isConn(c));
    const rp = root ? props(root, s) : p;
    const rw = finite(rp.get("w")) ?? 0, rh = finite(rp.get("h")) ?? 0;
    if (root) boxSizes.set(root, { w: rw, h: rh });
    const sp = finite(p.get("sp")) ?? rh * 0.4;
    const align = n.params.get("hierAlign") ?? "tCtrCh";
    const side = align[0] ?? "t";
    const blocks = n.children.filter((c) => c.alg === "hierChild").map((c) => ({ c, t: measure(c, s) })).filter((b) => b.t.w > 0);
    const isAsst = (b: { c: LayoutNode }): boolean => b.c.children.some((x) => x.alg === "hierRoot" && x.point.type === "asst");
    if (side === "l" || side === "r") {
      // Root beside its children's column (its assistants' column between),
      // centred on it, or at its top or bottom.
      const columns = [blocks.filter(isAsst), blocks.filter((b) => !isAsst(b))].filter((c) => c.length > 0);
      const cols = columns.map((col) => ({ col, w: Math.max(...col.map((b) => b.t.w)), h: col.reduce((a, b) => a + b.t.h, 0) + sp * (col.length - 1) }));
      const h = Math.max(rh, ...cols.map((c) => c.h));
      const at = (size: number): number => (align.endsWith("T") ? 0 : align.endsWith("B") ? h - size : (h - size) / 2);
      const w = rw + cols.reduce((a, c) => a + sp + c.w, 0);
      const flip = (x: number, width: number): number => (side === "l" ? x : w - x - width);
      if (root) parts.push({ node: root, x: flip(0, rw), y: at(rh) });
      let x = rw;
      for (const c of cols) {
        x += sp;
        let y = at(c.h);
        for (const b of c.col) {
          parts.push({ node: b.c, x: flip(x, b.t.w), y });
          y += b.t.h + sp;
        }
        x += c.w;
      }
      tree = { w, h, parts };
    } else {
      // Around the root's stem (x = 0 is the middle of the root's box).
      if (root) parts.push({ node: root, x: -rw / 2, y: 0 });
      let y = rh;
      for (const b of [...blocks.filter(isAsst), ...blocks.filter((b) => !isAsst(b))]) {
        y += sp;
        const indent = rw * (finite(p.get("alignOff")) || 0.25);
        const x = isAsst(b) ? -b.t.w - rw * 0.15
          : !stacked(b.c) ? (align === "tL" ? -rw / 2 : align === "tR" ? rw / 2 - b.t.w : -b.t.w / 2)
          : b.c.params.get("chAlign") === "r" ? rw / 2 - indent - b.t.w : -rw / 2 + indent;
        parts.push({ node: b.c, x, y });
        y += b.t.h;
      }
      const x0 = Math.min(...parts.map((q) => q.x));
      const x1 = Math.max(...parts.map((q) => q.x + (q.node === root ? rw : (trees.get(q.node)?.w ?? 0))));
      for (const q of parts) q.x -= x0;
      tree = { w: x1 - x0, h: y, parts };
    }
  } else {
    const kids = n.children.filter((c) => c.alg === "hierRoot").map((c) => ({ c, t: measure(c, s) }));
    if (n.params.get("linDir") === "fromR") kids.reverse();
    const sib = finite(p.get("sibSp")) ?? 0;
    const sideways = /^[lr]/.test(n.parent?.params.get("hierAlign") ?? "") || /^[lr]/.test(kids[0]?.c.params.get("hierAlign") ?? "");
    let pos = 0;
    if (stacked(n)) {
      const w = Math.max(0, ...kids.map((k) => k.t.w));
      // A hanging branch packs closer than a column of siblings.
      const gap = sideways ? sib : (finite(p.get("secSibSp")) ?? sib) * 0.5;
      for (const { c, t } of kids) {
        parts.push({ node: c, x: n.params.get("chAlign") === "r" ? w - t.w : 0, y: pos });
        pos += t.h + gap;
      }
      tree = { w, h: Math.max(0, pos - gap), parts };
    } else {
      // Side by side, each subtree as close as its boxes allow: a leaf
      // manager tucks in beside its neighbour's box, over that one's children.
      const placed: Box[] = [];
      for (const { c } of kids) {
        const mine = outline(c);
        let x = 0;
        for (const q of mine) {
          for (const o of placed) if (q.y < o.y + o.h && o.y < q.y + q.h) x = Math.max(x, o.x + o.w + sib - q.x);
        }
        parts.push({ node: c, x, y: 0 });
        placed.push(...mine.map((q) => ({ ...q, x: q.x + x })));
        pos = Math.max(pos, ...mine.map((q) => q.x + q.w + x));
      }
      tree = { w: pos, h: Math.max(0, ...kids.map((k) => k.t.h)), parts };
    }
  }
  trees.set(n, tree);
  return tree;
}

/** Every box a laid-out hierarchy node draws, in its own coordinates. */
function outline(n: LayoutNode): Box[] {
  const tree = trees.get(n);
  if (!tree) return [];
  return tree.parts.flatMap((q) => {
    if (q.node.alg === "hierRoot" || q.node.alg === "hierChild") return outline(q.node).map((b) => ({ ...b, x: b.x + q.x, y: b.y + q.y }));
    const size = boxSizes.get(q.node);
    return size ? [{ x: q.x, y: q.y, w: size.w, h: size.h }] : [];
  });
}

const boxSizes = new WeakMap<LayoutNode, { w: number; h: number }>();

function arrange(n: LayoutNode, x: number, y: number, k: number, s: LayoutState): void {
  const tree = trees.get(n);
  if (!tree) return;
  n.box = { x, y, w: tree.w * k, h: tree.h * k };
  for (const q of tree.parts) {
    if (q.node.alg === "hierRoot" || q.node.alg === "hierChild") arrange(q.node, x + q.x * k, y + q.y * k, k, s);
    else {
      const p = props(q.node, s);
      place(q.node, { x: x + q.x * k, y: y + q.y * k, w: (finite(p.get("w")) ?? 0) * k, h: (finite(p.get("h")) ?? 0) * k }, s);
    }
  }
}

/** Stacked levels narrowing to the top, each a slice of one big triangle. */
function pyramid(n: LayoutNode, box: Box): void {
  const levels = n.children.filter((c) => !isSpace(c));
  const count = levels.length;
  if (count === 0) return;
  const fromTop = (n.params.get("linDir") ?? "fromT") === "fromT";
  const lvlName = n.params.get("pyraLvlNode") ?? "";
  const h = box.h / count;
  levels.forEach((c, i) => {
    // Level i from the apex: its bottom edge is (i+1)/count of the base.
    const apex = fromTop ? i : count - 1 - i;
    const w = (box.w * (apex + 1)) / count;
    const lb: Box = { x: box.x + (box.w - w) / 2, y: box.y + h * apex, w, h };
    c.box = lb;
    const inset = box.w / count / 2;
    const ss = Math.min(w, h);
    for (const leaf of c.children.length > 0 ? c.children : [c]) {
      if (leaf.name === lvlName || (leaf === c && c.children.length === 0)) {
        leaf.adjust = [["adj", `val ${Math.round((inset / ss) * 100000)}`]];
        leaf.box = lb;
      } else if (leaf.name === n.params.get("pyraAcctBkgdNode") || leaf.name === n.params.get("pyraAcctTxNode")) {
        leaf.box = null;
      } else {
        // The level's text: the middle of the trapezoid.
        leaf.box = { x: lb.x + inset / 2, y: lb.y, w: Math.max(0, lb.w - inset), h: lb.h };
      }
    }
  });
}
