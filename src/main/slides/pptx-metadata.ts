import fs from "node:fs";
import path from "node:path";
import { unzipSync, type Unzipped } from "fflate";
import { XMLParser } from "fast-xml-parser";
import { SLIDES_MIN_ADVANCE_MS } from "@shared/constants";

export type ContainerKind = "ooxml" | "binary" | "odf" | "unknown";

export type SlideTiming = {
  /** 1-based, in presentation order. */
  slideIndex: number;
  partName: string;
  autoAdvanceMs: number | null;
  advanceOnClick: boolean;
  transitionMs: number | null;
  hidden: boolean;
  title: string | null;
  notes: string | null;
};

export type AudioRef = {
  partName: string;
  startSlideIndex: number;
  origin: "embedded" | "transition";
  loop: boolean;
  volume: number | null;
  scope: "deck" | "slide";
};

export type PresentationMeta = {
  slideCount: number;
  slideSizeEmu: { cx: number; cy: number } | null;
  slides: SlideTiming[];
  audio: AudioRef[];
  /** Media parts we deliberately do not extract (video is out of scope for
   *  now) — recorded so it's visible how often it actually shows up. */
  skippedVideoParts: string[];
};

export type ExtractedAudio = AudioRef & {
  file: string;
  ext: string;
  bytes: number;
  playable: boolean;
};

/** Chromium can't decode these, so mark them unplayable rather than silently
 *  producing an <audio> element that never makes a sound. */
const UNPLAYABLE_AUDIO_EXT = new Set(["wma", "mid", "midi"]);
const AUDIO_EXT = new Set([
  "mp3",
  "m4a",
  "aac",
  "wav",
  "ogg",
  "oga",
  "opus",
  "wma",
  "mid",
  "midi",
]);
const VIDEO_EXT = new Set(["mp4", "m4v", "mov", "wmv", "avi", "mkv", "webm"]);

/** Repeated elements that must stay arrays even when a deck happens to have
 *  exactly one of them — otherwise a one-slide deck parses as an object and
 *  every downstream `.map` silently sees nothing. */
const ALWAYS_ARRAY = ["p:sldIdLst.p:sldId", "Relationships.Relationship", "p:spTree.p:pic"];

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  removeNSPrefix: false,
  parseAttributeValue: false,
  isArray: (_name, jpath) => {
    const p = String(jpath);
    return ALWAYS_ARRAY.some((suffix) => p.endsWith(suffix));
  },
});

type XmlNode = Record<string, unknown>;

function asNode(value: unknown): XmlNode | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as XmlNode)
    : undefined;
}

function asNodes(value: unknown): XmlNode[] {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) return value.filter((v): v is XmlNode => asNode(v) !== undefined);
  const node = asNode(value);
  return node ? [node] : [];
}

function attr(node: XmlNode | undefined, name: string): string | undefined {
  const value = node?.[name];
  return typeof value === "string" ? value : undefined;
}

export function containerKind(filePath: string): ContainerKind {
  let fd: number | null = null;
  try {
    fd = fs.openSync(filePath, "r");
    const head = Buffer.alloc(4);
    fs.readSync(fd, head, 0, 4, 0);
    // OLE2 compound file (legacy .ppt/.pps)
    if (head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0) {
      return "binary";
    }
    if (head[0] === 0x50 && head[1] === 0x4b) {
      // A zip: OOXML or ODF. Distinguish by extension, cheap and reliable here.
      return path.extname(filePath).toLowerCase() === ".odp" ? "odf" : "ooxml";
    }
    return "unknown";
  } catch {
    return "unknown";
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}

/** Decompresses only the entries we actually read — important on a 200 MB deck
 *  where the media parts should stay compressed until extraction. */
function readEntries(filePath: string, wanted: (name: string) => boolean): Unzipped {
  const buf = fs.readFileSync(filePath);
  return unzipSync(new Uint8Array(buf), { filter: (file) => wanted(file.name) });
}

function decode(entry: Uint8Array | undefined): string | null {
  if (!entry) return null;
  return Buffer.from(entry).toString("utf8");
}

type Rels = Map<string, string>;

/** Relationship targets are relative to the part's own directory. */
function parseRels(xml: string | null, baseDir: string): Rels {
  const map: Rels = new Map();
  if (!xml) return map;
  const doc = asNode(parser.parse(xml));
  const root = asNode(doc?.["Relationships"]);
  for (const rel of asNodes(root?.["Relationship"])) {
    const id = attr(rel, "@Id");
    const target = attr(rel, "@Target");
    if (!id || !target) continue;
    if (/^https?:/i.test(target)) continue;
    map.set(id, path.posix.normalize(path.posix.join(baseDir, target)));
  }
  return map;
}

/**
 * PowerPoint 2010+ wraps the transition in
 * `mc:AlternateContent/mc:Choice[@Requires="p14"]`, keeping a legacy copy in
 * `mc:Fallback`. A bare `p:transition` also occurs. Checking only the bare
 * element is the single most common way to silently read no timings at all.
 */
function findTransition(slide: XmlNode): XmlNode | undefined {
  const alt = asNode(slide["mc:AlternateContent"]);
  const fromChoice = asNode(asNode(alt?.["mc:Choice"])?.["p:transition"]);
  if (fromChoice) return fromChoice;

  const fromFallback = asNode(asNode(alt?.["mc:Fallback"])?.["p:transition"]);
  if (fromFallback) return fromFallback;

  return asNode(slide["p:transition"]);
}

function collectText(node: unknown, out: string[]): void {
  if (node === null || node === undefined) return;
  if (Array.isArray(node)) {
    for (const child of node) collectText(child, out);
    return;
  }
  if (typeof node !== "object") return;
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === "a:t") {
      if (typeof value === "string") out.push(value);
      else if (Array.isArray(value)) for (const v of value) if (typeof v === "string") out.push(v);
    } else if (typeof value === "object") {
      collectText(value, out);
    }
  }
}

function isIndefinite(node: XmlNode): boolean {
  return attr(asNode(node["p:cTn"]), "@repeatCount") === "indefinite";
}

/** Walks p:timing looking for media nodes, which is where loop/volume live. */
function collectMediaNodes(node: unknown, out: XmlNode[]): void {
  if (node === null || node === undefined || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) collectMediaNodes(child, out);
    return;
  }
  for (const [key, value] of Object.entries(node as XmlNode)) {
    if (key === "p:cMediaNode") {
      out.push(...asNodes(value));
    } else if (typeof value === "object") {
      collectMediaNodes(value, out);
    }
  }
}

export function readPresentationMeta(filePath: string): PresentationMeta {
  const entries = readEntries(
    filePath,
    (name) =>
      name === "ppt/presentation.xml" ||
      name === "ppt/_rels/presentation.xml.rels" ||
      (name.startsWith("ppt/slides/") && name.endsWith(".xml")) ||
      (name.startsWith("ppt/slides/_rels/") && name.endsWith(".rels")) ||
      (name.startsWith("ppt/notesSlides/") && name.endsWith(".xml")),
  );

  const presentationXml = decode(entries["ppt/presentation.xml"]);
  if (!presentationXml) {
    throw new Error("ppt/presentation.xml missing — not a presentation");
  }

  const presentation = asNode(parser.parse(presentationXml));
  const root = asNode(presentation?.["p:presentation"]);

  const sldSz = asNode(root?.["p:sldSz"]);
  const cx = attr(sldSz, "@cx");
  const cy = attr(sldSz, "@cy");
  const slideSizeEmu = cx && cy ? { cx: Number(cx), cy: Number(cy) } : null;

  const presentationRels = parseRels(decode(entries["ppt/_rels/presentation.xml.rels"]), "ppt");

  // p:sldIdLst is the PRESENTATION order. slide1.xml/slide2.xml is the creation
  // order and diverges the moment someone reorders — using it would desync
  // every timing from its slide.
  const sldIds = asNodes(asNode(root?.["p:sldIdLst"])?.["p:sldId"]);

  const slides: SlideTiming[] = [];
  const audio: AudioRef[] = [];
  const skippedVideoParts: string[] = [];

  sldIds.forEach((sldId, position) => {
    const rId = attr(sldId, "@r:id");
    const partName = rId ? presentationRels.get(rId) : undefined;
    if (!partName) return;

    const slideXml = decode(entries[partName]);
    if (!slideXml) return;

    const slideIndex = position + 1;
    const sld = asNode(asNode(parser.parse(slideXml))?.["p:sld"]) ?? {};

    const slideDir = path.posix.dirname(partName);
    const relsName = path.posix.join(slideDir, "_rels", `${path.posix.basename(partName)}.rels`);
    const slideRels = parseRels(decode(entries[relsName]), slideDir);

    // @show absent or "1" = visible. LibreOffice still exports hidden slides to
    // the PDF, so the flag has to be recorded or indices drift.
    const showAttr = attr(sld, "@show");
    const hidden = showAttr === "0" || showAttr === "false";

    const transition = findTransition(sld);
    const advTm = attr(transition, "@advTm");
    const rawAdvance = advTm !== undefined ? Number(advTm) : NaN;
    const autoAdvanceMs = Number.isFinite(rawAdvance)
      ? Math.max(SLIDES_MIN_ADVANCE_MS, rawAdvance)
      : null;

    const advClick = attr(transition, "@advClick");
    const advanceOnClick = !(advClick === "0" || advClick === "false");

    const durAttr = attr(transition, "@p14:dur") ?? attr(transition, "@dur");
    const transitionMs =
      durAttr !== undefined && Number.isFinite(Number(durAttr)) ? Number(durAttr) : null;

    const cSld = asNode(sld["p:cSld"]);
    const title = attr(cSld, "@name") ?? null;

    // Speaker notes: cheap to grab and genuinely useful to an operator.
    let notes: string | null = null;
    for (const target of slideRels.values()) {
      if (!target.startsWith("ppt/notesSlides/")) continue;
      const notesXml = decode(entries[target]);
      if (!notesXml) continue;
      const chunks: string[] = [];
      collectText(parser.parse(notesXml), chunks);
      const joined = chunks.join(" ").trim();
      if (joined) notes = joined;
      break;
    }

    // Media playback semantics live in p:timing.
    const mediaNodes: XmlNode[] = [];
    collectMediaNodes(sld["p:timing"], mediaNodes);
    const anyLoop = mediaNodes.some((node) => {
      const loop = attr(node, "@loop");
      return loop === "1" || loop === "true" || isIndefinite(node);
    });
    const volumeRaw = mediaNodes.map((node) => attr(node, "@vol")).find((v) => v !== undefined);
    const volume =
      volumeRaw !== undefined && Number.isFinite(Number(volumeRaw))
        ? Number(volumeRaw) / 100000
        : null;

    // Slide-placed audio (p:pic with an a:audioFile) and transition sounds.
    const spTree = asNode(cSld?.["p:spTree"]);
    for (const pic of asNodes(spTree?.["p:pic"])) {
      const nvPr = asNode(asNode(pic["p:nvPicPr"])?.["p:nvPr"]);
      const audioFile = asNode(nvPr?.["a:audioFile"]);
      const videoFile = asNode(nvPr?.["a:videoFile"]);

      if (videoFile) {
        const rid = attr(videoFile, "@r:link") ?? attr(videoFile, "@r:embed");
        const target = rid ? slideRels.get(rid) : undefined;
        if (target) skippedVideoParts.push(target);
        continue;
      }
      if (!audioFile) continue;

      const rid = attr(audioFile, "@r:link") ?? attr(audioFile, "@r:embed");
      const target = rid ? slideRels.get(rid) : undefined;
      if (!target) continue;

      audio.push({
        partName: target,
        startSlideIndex: slideIndex,
        origin: "embedded",
        loop: anyLoop,
        volume,
        // OOXML has no single "play across slides" boolean — PowerPoint encodes
        // it through p:cTn/@dur, p:endSync and the node's position in the main
        // sequence. This is a documented heuristic; the raw values are kept so
        // it can be corrected later without re-parsing.
        scope: anyLoop ? "deck" : "slide",
      });
    }

    const stSnd = asNode(asNode(transition?.["p:sndAc"])?.["p:stSnd"]);
    const snd = asNode(stSnd?.["p:snd"]);
    if (snd) {
      const rid = attr(snd, "@r:embed") ?? attr(snd, "@r:link");
      const target = rid ? slideRels.get(rid) : undefined;
      if (target) {
        audio.push({
          partName: target,
          startSlideIndex: slideIndex,
          origin: "transition",
          loop: attr(stSnd, "@loop") === "1",
          volume: null,
          scope: "slide",
        });
      }
    }

    slides.push({
      slideIndex,
      partName,
      autoAdvanceMs,
      advanceOnClick,
      transitionMs,
      hidden,
      title,
      notes,
    });
  });

  return { slideCount: slides.length, slideSizeEmu, slides, audio, skippedVideoParts };
}

/**
 * Writes each referenced media part into `destDir`. Output filenames are
 * generated (`1.mp3`, `2.wav`, …) and NEVER derived from the zip entry name —
 * a hostile or merely odd .pptx can carry `../` in a part name.
 */
export function extractAudioParts(
  filePath: string,
  refs: AudioRef[],
  destDir: string,
): ExtractedAudio[] {
  if (refs.length === 0) return [];

  const wanted = new Set(refs.map((ref) => ref.partName));
  const entries = readEntries(filePath, (name) => wanted.has(name));

  fs.mkdirSync(destDir, { recursive: true });

  const extracted: ExtractedAudio[] = [];
  const seen = new Map<string, ExtractedAudio>();

  refs.forEach((ref, index) => {
    const data = entries[ref.partName];
    if (!data) return;

    // The same media part can be referenced by several slides; write it once.
    const already = seen.get(ref.partName);
    if (already) {
      extracted.push({ ...ref, file: already.file, ext: already.ext, bytes: already.bytes, playable: already.playable });
      return;
    }

    const rawExt = path.posix.extname(ref.partName).replace(/^\./, "").toLowerCase();
    if (VIDEO_EXT.has(rawExt)) return;
    const ext = AUDIO_EXT.has(rawExt) ? rawExt : "bin";
    const file = `${index + 1}.${ext}`;

    fs.writeFileSync(path.join(destDir, file), data);

    const record: ExtractedAudio = {
      ...ref,
      file,
      ext,
      bytes: data.byteLength,
      playable: ext !== "bin" && !UNPLAYABLE_AUDIO_EXT.has(ext),
    };
    seen.set(ref.partName, record);
    extracted.push(record);
  });

  return extracted;
}
