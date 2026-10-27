import { XMLParser } from "fast-xml-parser";

/**
 * An XML element with its children IN ORDER — on a slide, document order is
 * paint order, and a run's place among its siblings is the text. Names carry
 * the CANONICAL prefix of their namespace (`p:sp`, `a:t`), whatever prefix the
 * file used: OOXML only fixes the namespace URIs, and a generator that binds
 * DrawingML to `x:` (or to the default namespace) is valid.
 */
export type XmlElement = {
  name: string;
  attrs: Record<string, string>;
  children: XmlElement[];
  /** The element's own text, its text children joined. */
  text: string;
};

const CANONICAL: Record<string, string> = {
  "http://schemas.openxmlformats.org/presentationml/2006/main": "p",
  "http://schemas.openxmlformats.org/drawingml/2006/main": "a",
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships": "r",
  "http://schemas.openxmlformats.org/drawingml/2006/chart": "c",
  "http://schemas.openxmlformats.org/drawingml/2006/diagram": "dgm",
  "http://schemas.microsoft.com/office/drawing/2008/diagram": "dsp",
  "http://schemas.openxmlformats.org/markup-compatibility/2006": "mc",
  "http://schemas.openxmlformats.org/package/2006/relationships": "rel",
  "http://schemas.openxmlformats.org/package/2006/content-types": "ct",
  "http://schemas.microsoft.com/office/powerpoint/2010/main": "p14",
  "http://schemas.microsoft.com/office/drawing/2010/main": "a14",
  "http://schemas.openxmlformats.org/drawingml/2006/picture": "pic",
};

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: "",
  // `<a:t> </a:t>` is a real space between two runs.
  trimValues: false,
  parseTagValue: false,
  parseAttributeValue: false,
  processEntities: true,
  htmlEntities: false,
});

type Raw = Record<string, unknown>;

export function parseXml(bytes: Uint8Array | string): XmlElement | null {
  const source = typeof bytes === "string" ? bytes : Buffer.from(bytes).toString("utf8");
  let raw: Raw[];
  try {
    raw = parser.parse(source) as Raw[];
  } catch {
    return null;
  }
  const root = raw.find((node) => !("#text" in node) && !Object.keys(node)[0]!.startsWith("?"));
  return root ? convert(root, new Map()) : null;
}

function convert(node: Raw, inherited: Map<string, string>): XmlElement {
  const rawName = Object.keys(node).find((key) => key !== ":@")!;
  const rawAttrs = (node[":@"] ?? {}) as Record<string, string>;

  let scope = inherited;
  for (const [key, value] of Object.entries(rawAttrs)) {
    if (key === "xmlns" || key.startsWith("xmlns:")) {
      if (scope === inherited) scope = new Map(inherited);
      scope.set(key === "xmlns" ? "" : key.slice(6), value);
    }
  }
  const attrs: Record<string, string> = {};
  for (const [key, value] of Object.entries(rawAttrs)) {
    if (key === "xmlns" || key.startsWith("xmlns:")) continue;
    // An unprefixed attribute has no namespace; a prefixed one is renamed
    // like an element (`r:embed` stays `r:embed` under any prefix).
    attrs[key.includes(":") ? canonicalName(key, scope, false) : key] = String(value);
  }

  const children: XmlElement[] = [];
  let text = "";
  for (const child of (node[rawName] ?? []) as Raw[]) {
    if ("#text" in child) text += String(child["#text"]);
    else if (Object.keys(child)[0]?.startsWith("?") !== true) children.push(convert(child, scope));
  }
  return { name: canonicalName(rawName, scope, true), attrs, children: resolveAlternates(children), text };
}

function canonicalName(name: string, scope: Map<string, string>, isElement: boolean): string {
  const colon = name.indexOf(":");
  const prefix = colon < 0 ? "" : name.slice(0, colon);
  const local = colon < 0 ? name : name.slice(colon + 1);
  if (!isElement && colon < 0) return local;
  const uri = scope.get(prefix);
  const canonical = uri === undefined ? undefined : CANONICAL[uri];
  if (canonical !== undefined) return `${canonical}:${local}`;
  return name;
}

/**
 * `mc:AlternateContent` offers the same content twice: a `Choice` that needs a
 * newer feature set and a `Fallback` any reader understands. We take the
 * fallback — what PowerPoint 2007 drew — unless there is none, in which case
 * the first choice is all there is.
 */
function resolveAlternates(children: XmlElement[]): XmlElement[] {
  if (!children.some((c) => c.name === "mc:AlternateContent")) return children;
  return children.flatMap((child) => {
    if (child.name !== "mc:AlternateContent") return [child];
    const branch = child.children.find((c) => c.name === "mc:Fallback") ?? child.children.find((c) => c.name === "mc:Choice");
    return branch ? branch.children : [];
  });
}

export function child(el: XmlElement | null | undefined, name: string): XmlElement | null {
  if (!el) return null;
  for (const c of el.children) if (c.name === name) return c;
  return null;
}

export function children(el: XmlElement | null | undefined, name: string): XmlElement[] {
  return el ? el.children.filter((c) => c.name === name) : [];
}

/** `path(el, "p:spPr", "a:xfrm")` — the first match at each step. */
export function path(el: XmlElement | null | undefined, ...names: string[]): XmlElement | null {
  let at = el ?? null;
  for (const name of names) at = child(at, name);
  return at;
}

export function descendants(el: XmlElement | null | undefined, name: string, out: XmlElement[] = []): XmlElement[] {
  if (!el) return out;
  for (const c of el.children) {
    if (c.name === name) out.push(c);
    descendants(c, name, out);
  }
  return out;
}

export function attr(el: XmlElement | null | undefined, name: string): string | null {
  return el?.attrs[name] ?? null;
}

export function numAttr(el: XmlElement | null | undefined, name: string, fallback: number): number;
export function numAttr(el: XmlElement | null | undefined, name: string, fallback: null): number | null;
export function numAttr(el: XmlElement | null | undefined, name: string, fallback: number | null): number | null {
  const raw = el?.attrs[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

/** OOXML booleans: `1`/`true`/`on` are true. */
export function isTrue(raw: string | null | undefined): boolean {
  return raw === "1" || raw === "true" || raw === "on";
}

export function boolAttr(el: XmlElement | null | undefined, name: string, fallback: boolean): boolean {
  const raw = el?.attrs[name];
  return raw === undefined ? fallback : isTrue(raw);
}
