import { attr, child, children, numAttr, type XmlElement } from "../xml";

/**
 * A SmartArt diagram's data model (`dgm:dataModel`) as a tree, and its layout
 * definition (`dgm:layoutDef`) unrolled against it: every `forEach` iterated,
 * every `choose` decided, so what is left is one layout node per shape the
 * diagram can draw. ECMA-376 §21.4.
 */

export type Point = {
  id: string;
  /** `doc`, `node`, `asst`, `parTrans`, `sibTrans` (`pres` points are kept apart). */
  type: string;
  text: XmlElement | null;
  spPr: XmlElement | null;
  /** For a node: its node children, in order. */
  children: Point[];
  /** For a node: its parent node; for a transition: the node its connection starts at. */
  parent: Point | null;
  /** For a transition: the node it leads to. */
  owner: Point | null;
  parTrans: Point | null;
  sibTrans: Point | null;
  depth: number;
};

export type DataModel = {
  root: Point;
  /** Presentation points by `presAssocID|presName`: what PowerPoint stored
   *  for one layout node of one data point (style label and index, the
   *  user's own fill, layout variables). */
  pres: Map<string, XmlElement>;
};

export function readDataModel(dm: XmlElement | null): DataModel {
  const points = new Map<string, Point>();
  const pres = new Map<string, XmlElement>();
  for (const pt of children(child(dm, "dgm:ptLst"), "dgm:pt")) {
    const type = attr(pt, "type") ?? "node";
    const prSet = child(pt, "dgm:prSet");
    if (type === "pres") {
      pres.set(`${attr(prSet, "presAssocID")}|${attr(prSet, "presName")}`, pt);
      continue;
    }
    const id = attr(pt, "modelId") ?? "";
    points.set(id, {
      id, type, text: child(pt, "dgm:t"), spPr: child(pt, "dgm:spPr"),
      children: [], parent: null, owner: null, parTrans: null, sibTrans: null, depth: 0,
    });
  }
  const links = children(child(dm, "dgm:cxnLst"), "dgm:cxn")
    .filter((c) => (attr(c, "type") ?? "parOf") === "parOf")
    .sort((a, b) => numAttr(a, "srcOrd", 0) - numAttr(b, "srcOrd", 0));
  for (const c of links) {
    const src = points.get(attr(c, "srcId") ?? "");
    const dst = points.get(attr(c, "destId") ?? "");
    if (!src || !dst || dst.parent || dst === src) continue;
    dst.parent = src;
    src.children.push(dst);
    for (const [key, field] of [["parTransId", "parTrans"], ["sibTransId", "sibTrans"]] as const) {
      const t = points.get(attr(c, key) ?? "");
      if (!t) continue;
      t.parent = src;
      t.owner = dst;
      dst[field] = t;
    }
  }
  const root = [...points.values()].find((p) => p.type === "doc")
    ?? { id: "", type: "doc", text: null, spPr: null, children: [], parent: null, owner: null, parTrans: null, sibTrans: null, depth: 0 };
  // Nodes nobody parents (a model written without the doc's links) hang off the doc.
  for (const p of points.values()) {
    if (p !== root && !p.parent && (p.type === "node" || p.type === "asst")) {
      p.parent = root;
      root.children.push(p);
    }
  }
  const depth = (p: Point, d: number, seen: Set<Point>): void => {
    if (seen.has(p)) return;
    seen.add(p);
    p.depth = d;
    for (const t of [p.parTrans, p.sibTrans]) if (t) t.depth = d;
    for (const c of p.children) depth(c, d + 1, seen);
  };
  depth(root, 0, new Set());
  return { root, pres };
}

export type Constraint = {
  type: string;
  for: string;
  forName: string | null;
  ptType: string | null;
  refType: string | null;
  refFor: string;
  refForName: string | null;
  refPtType: string | null;
  op: string;
  fact: number;
  val: number | null;
};

export type LayoutNode = {
  name: string;
  point: Point;
  parent: LayoutNode | null;
  children: LayoutNode[];
  alg: string;
  params: Map<string, string>;
  shape: XmlElement | null;
  presOf: XmlElement | null;
  constraints: Constraint[];
  /** The `dgm:rule`s: which constraints may give way when content doesn't fit. */
  rules: Constraint[];
  vars: Map<string, string>;
  styleLbl: string | null;
  /** `chOrder="t"`: the first child is drawn on top (inherited down the tree). */
  topFirst: boolean;
  /** The user's resize of this node (`custScaleX/Y`), 1 when none. */
  scale: { x: number; y: number };
  /** Filled by the layout pass. */
  props: Map<string, number>;
  box: Box | null;
  rot: number;
  /** Adjust values the algorithm imposes (a pyramid level's slope). */
  adjust: [string, string][] | null;
};

export type Box = { x: number; y: number; w: number; h: number };

const MAX_DEPTH = 40;

/** The layout definition unrolled over the data model. */
export function buildLayoutTree(lo: XmlElement | null, model: DataModel): LayoutNode | null {
  const rootDef = child(lo, "dgm:layoutNode");
  if (!rootDef) return null;
  const named = new Map<string, XmlElement>();
  const collect = (el: XmlElement): void => {
    for (const c of el.children) {
      if (c.name === "dgm:forEach" && attr(c, "name")) named.set(attr(c, "name")!, c);
      collect(c);
    }
  };
  collect(lo!);
  const env: Env = { model, named };
  return build(rootDef, model.root, null, env, 0);
}

type Env = { model: DataModel; named: Map<string, XmlElement> };

function build(def: XmlElement, point: Point, parent: LayoutNode | null, env: Env, depth: number): LayoutNode {
  const node: LayoutNode = {
    name: attr(def, "name") ?? "",
    point,
    parent,
    children: [],
    alg: "composite",
    params: new Map(),
    shape: null,
    presOf: null,
    constraints: [],
    rules: [],
    vars: new Map(),
    styleLbl: attr(def, "styleLbl"),
    topFirst: (attr(def, "chOrder") ?? (parent?.topFirst ? "t" : "b")) === "t",
    scale: { x: 1, y: 1 },
    props: new Map(),
    box: null,
    rot: 0,
    adjust: null,
  };
  const prSet = child(env.model.pres.get(`${point.id}|${node.name}`), "dgm:prSet");
  node.scale = { x: numAttr(prSet, "custScaleX", 100000) / 100000 || 1, y: numAttr(prSet, "custScaleY", 100000) / 100000 || 1 };
  absorb(node, def, point, env, depth);
  return node;
}

function absorb(node: LayoutNode, container: XmlElement, point: Point, env: Env, depth: number): void {
  if (depth > MAX_DEPTH) return;
  for (const c of container.children) {
    switch (c.name) {
      case "dgm:alg":
        node.alg = attr(c, "type") ?? "composite";
        node.params = new Map(children(c, "dgm:param").map((p) => [attr(p, "type") ?? "", attr(p, "val") ?? ""]));
        break;
      case "dgm:shape":
        node.shape = c;
        break;
      case "dgm:presOf":
        node.presOf = c;
        break;
      case "dgm:constrLst":
        node.constraints.push(...children(c, "dgm:constr").map(readConstraint));
        break;
      case "dgm:ruleLst":
        node.rules.push(...children(c, "dgm:rule").map(readConstraint));
        break;
      case "dgm:varLst":
        for (const v of c.children) node.vars.set(v.name.replace(/^dgm:/, ""), attr(v, "val") ?? "");
        break;
      case "dgm:layoutNode":
        node.children.push(build(c, point, node, env, depth + 1));
        break;
      case "dgm:forEach": {
        const ref = attr(c, "ref");
        const def = ref ? (env.named.get(ref) ?? c) : c;
        for (const p of select(def, point, env.model)) absorb(node, def, p, env, depth + 1);
        break;
      }
      case "dgm:choose": {
        const branch = c.children.find((b) => b.name === "dgm:if" && holds(b, point, node, env.model))
          ?? child(c, "dgm:else");
        if (branch) absorb(node, branch, point, env, depth + 1);
        break;
      }
      default:
        break;
    }
  }
}

function readConstraint(c: XmlElement): Constraint {
  const num = (name: string): number | null => {
    const raw = attr(c, name);
    if (raw === null) return null;
    if (raw === "INF") return Infinity;
    const v = Number(raw);
    return Number.isNaN(v) ? null : v;
  };
  return {
    type: attr(c, "type") ?? "none",
    for: attr(c, "for") ?? "self",
    forName: attr(c, "forName"),
    ptType: attr(c, "ptType"),
    refType: attr(c, "refType"),
    refFor: attr(c, "refFor") ?? "self",
    refForName: attr(c, "refForName"),
    refPtType: attr(c, "refPtType"),
    op: attr(c, "op") ?? "none",
    fact: num("fact") ?? 1,
    val: num("val"),
  };
}

/** Does a point's type match an OOXML `ST_ElementType`? */
export function typeMatches(p: Point, want: string | null): boolean {
  switch (want ?? "all") {
    case "all":
      return true;
    case "node":
      return p.type === "node" || p.type === "asst";
    case "norm":
      return p.type === "node";
    // The two «non» types still mean nodes: org charts iterate a node's
    // children with `nonAsst` and find each one's transition from there.
    case "nonNorm":
      return p.type === "asst";
    case "nonAsst":
      return p.type === "node";
    default:
      return p.type === want;
  }
}

/** The points a `forEach`, `if` or `presOf` selects from `point`: each axis
 *  step in turn, filtered by its point type, then `st`/`cnt`/`step`. */
export function select(el: XmlElement, point: Point, model: DataModel): Point[] {
  const list = (name: string): string[] => (attr(el, name) ?? "").split(/\s+/).filter(Boolean);
  const axes = list("axis");
  if (axes.length === 0) axes.push("self");
  const types = list("ptType");
  const starts = list("st");
  const counts = list("cnt");
  const steps = list("step");
  const hides = list("hideLastTrans");
  let current = [point];
  axes.forEach((axis, i) => {
    const type = types[i] ?? types[types.length - 1] ?? "all";
    const hide = (hides[i] ?? hides[hides.length - 1] ?? "1") !== "0" && (hides[i] ?? hides[hides.length - 1]) !== "false";
    let next = current.flatMap((p) => axisStep(p, axis, model).filter((q) => typeMatches(q, type)));
    if (hide && type === "sibTrans") next = next.filter((q) => !isLastTrans(q));
    const st = Number(starts[i] ?? 1) || 1;
    const cnt = Number(counts[i] ?? 0) || 0;
    const step = Number(steps[i] ?? 1) || 1;
    const from = st > 0 ? st - 1 : Math.max(0, next.length + st);
    const out: Point[] = [];
    for (let k = from; k >= 0 && k < next.length && (cnt === 0 || out.length < cnt); k += step) out.push(next[k]!);
    current = out;
  });
  return current;
}

function isLastTrans(t: Point): boolean {
  const siblings = t.parent?.children ?? [];
  return t.type === "sibTrans" && t.owner !== null && siblings[siblings.length - 1] === t.owner;
}

/** A node's siblings with their transitions, in data order. */
function siblingRun(p: Point): Point[] {
  const parent = p.parent;
  if (!parent) return [p];
  return parent.children.flatMap((c) => [c.parTrans, c, c.sibTrans].filter((x): x is Point => x !== null));
}

function axisStep(p: Point, axis: string, model: DataModel): Point[] {
  switch (axis) {
    case "self":
      return [p];
    case "ch":
      return p.children.flatMap((c) => [c.parTrans, c, c.sibTrans].filter((x): x is Point => x !== null));
    case "des":
      return descendants(p);
    case "desOrSelf":
      return [p, ...descendants(p)];
    case "par":
      return p.parent ? [p.parent] : [];
    case "ancst":
    case "ancstOrSelf": {
      const out: Point[] = axis === "ancstOrSelf" ? [p] : [];
      for (let a = p.parent; a; a = a.parent) out.push(a);
      return out;
    }
    case "root":
      return [model.root];
    case "followSib":
    case "precedSib": {
      const run = siblingRun(p);
      const at = run.indexOf(p);
      if (at < 0) return [];
      return axis === "followSib" ? run.slice(at + 1) : run.slice(0, at);
    }
    default:
      return [];
  }
}

function descendants(p: Point): Point[] {
  const out: Point[] = [];
  const walk = (q: Point): void => {
    for (const c of q.children) {
      if (c.parTrans) out.push(c.parTrans);
      out.push(c);
      if (c.sibTrans) out.push(c.sibTrans);
      walk(c);
    }
  };
  walk(p);
  return out;
}

/** A layout variable (`dir`, `hierBranch`, …): what PowerPoint stored for this
 *  node, else up the layout tree, else the definition's default. */
export function variable(name: string, node: LayoutNode, model: DataModel): string {
  for (let n: LayoutNode | null = node; n; n = n.parent) {
    const pres = model.pres.get(`${n.point.id}|${n.name}`);
    const v = child(child(child(pres, "dgm:prSet"), "dgm:presLayoutVars"), `dgm:${name}`);
    if (v) return attr(v, "val") ?? DEFAULT_VARS[name] ?? "";
    const own = n.vars.get(name);
    if (own !== undefined && own !== "") return own;
  }
  return DEFAULT_VARS[name] ?? "";
}

const DEFAULT_VARS: Record<string, string> = { dir: "norm", hierBranch: "std", bulletEnabled: "0" };

function holds(el: XmlElement, point: Point, node: LayoutNode, model: DataModel): boolean {
  const func = attr(el, "func") ?? "";
  const op = attr(el, "op") ?? "equ";
  const want = attr(el, "val") ?? "";
  let value: string | number;
  switch (func) {
    case "cnt":
      value = select(el, point, model).length;
      break;
    case "var":
      value = variable(attr(el, "arg") ?? "", node, model);
      break;
    case "depth":
      value = point.depth;
      break;
    case "maxDepth": {
      const axes = (attr(el, "axis") ?? "").split(/\s+/).filter(Boolean);
      const base = axes.length > 1 ? select({ ...el, attrs: { ...el.attrs, axis: axes.slice(0, -1).join(" "), ptType: "all" } }, point, model)[0] : point;
      const pts = select(el, point, model);
      value = pts.length === 0 ? 0 : Math.max(...pts.map((p) => p.depth)) - (base?.depth ?? point.depth);
      break;
    }
    case "pos":
    case "revPos":
    case "posEven":
    case "posOdd": {
      const self = point.owner ?? point;
      const sibs = self.parent?.children ?? [self];
      const pos = sibs.indexOf(self) + 1;
      value = func === "pos" ? pos : func === "revPos" ? sibs.length - pos + 1 : func === "posEven" ? Number(pos % 2 === 0) : Number(pos % 2 === 1);
      break;
    }
    default:
      return false;
  }
  const a = typeof value === "number" ? value : Number(value);
  const b = Number(want);
  const numeric = Number.isFinite(a) && Number.isFinite(b) && want !== "";
  switch (op) {
    case "equ":
      return numeric ? a === b : String(value) === want;
    case "neq":
      return numeric ? a !== b : String(value) !== want;
    case "gt":
      return numeric && a > b;
    case "lt":
      return numeric && a < b;
    case "gte":
      return numeric && a >= b;
    case "lte":
      return numeric && a <= b;
    default:
      return false;
  }
}
