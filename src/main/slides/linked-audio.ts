import fs from "node:fs";
import path from "node:path";
import { unzipSync } from "fflate";
import { AUDIO_EXT, containerKind } from "./pptx-metadata";

/**
 * Old church hymnal decks (`.pps`/`.ppt`) rarely embed their soundtrack —
 * they point at an external `.mp3` that lived next to the file on whoever's
 * Windows machine made it. That link never survives a LibreOffice round-trip
 * (verified: converting one of these to `.pptx` drops it entirely, along with
 * `showPr`), so it has to be resolved straight from the original file, once,
 * against whatever now sits beside it.
 *
 * Three rules, in order of confidence:
 *  1. The file's own hint — the external link it recorded, matched by
 *     *basename* against the deck's folder (the recorded path is someone
 *     else's Windows machine; only the filename can still be right).
 *  2. The PowerPoint convention: `<same base name>.<audio ext>`.
 *  3. If the folder holds exactly one audio file, that's obviously it.
 */
export function resolveLinkedAudio(presentationPath: string): string | null {
  const dir = path.dirname(presentationPath);
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return null;
  }
  const audioFiles = entries.filter((name) => AUDIO_EXT.has(extOf(name)));
  if (audioFiles.length === 0) return null;

  const byNormalizedName = new Map(audioFiles.map((name) => [normalize(name), name]));

  const hint = extractAudioHintBasename(presentationPath);
  if (hint) {
    const match = byNormalizedName.get(normalize(hint));
    if (match) return path.join(dir, match);
  }

  const base = path.basename(presentationPath, path.extname(presentationPath));
  for (const ext of AUDIO_EXT) {
    const match = byNormalizedName.get(normalize(`${base}.${ext}`));
    if (match) return path.join(dir, match);
  }

  if (audioFiles.length === 1) return path.join(dir, audioFiles[0]!);

  return null;
}

function extOf(fileName: string): string {
  return path.extname(fileName).replace(/^\./, "").toLowerCase();
}

/** File names round-trip differently across filesystems (macOS favors NFD,
 *  Windows/the .pps favor NFC) — comparing raw bytes misses the exact match
 *  the church actually has on disk. */
function normalize(fileName: string): string {
  return fileName.normalize("NFC").toLowerCase();
}

/** Only the basename of whatever external audio path the deck itself recorded
 *  — never the path, which points at a Windows machine that isn't this one. */
function extractAudioHintBasename(presentationPath: string): string | null {
  const kind = containerKind(presentationPath);
  if (kind === "binary") return extractHintFromBinary(presentationPath);
  if (kind === "ooxml") return extractHintFromOoxml(presentationPath);
  return null;
}

const AUDIO_EXT_PATTERN = [...AUDIO_EXT].join("|");
// A run of printable characters ending in a known audio extension — loose on
// purpose, this is a hint to look up by basename, never a path we open.
const AUDIO_NAME_RE = new RegExp(`[^\\\\/:*?"<>|\\x00-\\x1f]{1,240}\\.(?:${AUDIO_EXT_PATTERN})`, "i");

/** Legacy `.ppt`/`.pps` (OLE2) store their linked-media path as a UTF-16LE
 *  string somewhere in the compound file — there's no structured record
 *  worth parsing for a hint this soft, so scan the raw bytes both as
 *  UTF-16LE and Windows-1252 text. */
function extractHintFromBinary(filePath: string): string | null {
  let buf: Buffer;
  try {
    buf = fs.readFileSync(filePath);
  } catch {
    return null;
  }
  for (const encoding of ["utf16le", "latin1"] as const) {
    const text = buf.toString(encoding);
    const match = AUDIO_NAME_RE.exec(text);
    if (match) return path.win32.basename(match[0]);
  }
  return null;
}

/** Modern `.pptx`/`.ppsx` link external audio via a `Relationship` with
 *  `TargetMode="External"` in a slide's `_rels` part. Read as text, not
 *  through the full XML parser: this is a best-effort hint, and a relaxed
 *  attribute-order-agnostic regex is enough to find it. */
function extractHintFromOoxml(filePath: string): string | null {
  let entries;
  try {
    const zipBuf = fs.readFileSync(filePath);
    entries = unzipSync(new Uint8Array(zipBuf), {
      filter: (file) => file.name.includes("_rels/") && file.name.endsWith(".rels"),
    });
  } catch {
    return null;
  }
  for (const [name, data] of Object.entries(entries)) {
    if (!name.includes("slides/_rels")) continue;
    const xml = Buffer.from(data).toString("utf8");
    for (const relMatch of xml.matchAll(/<Relationship\b[^>]*\/>/gi)) {
      const tag = relMatch[0];
      if (!/TargetMode\s*=\s*"External"/i.test(tag)) continue;
      const targetMatch = /Target\s*=\s*"([^"]+)"/i.exec(tag);
      if (!targetMatch) continue;
      const target = targetMatch[1]!;
      if (!AUDIO_EXT.has(extOf(target))) continue;
      return path.win32.basename(decodeURIComponent(target));
    }
  }
  return null;
}
