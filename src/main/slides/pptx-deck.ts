import fs from "node:fs";
import path from "node:path";
import { ooxmlDir } from "../paths";
import { parsePresetDefinitions } from "./pptx/geometry";
import { readPptxDeck, type PptxDeck, type PptxResources } from "./pptx/reader";
import { parseTableStyles } from "./pptx/table-style";

/**
 * The `.pptx` reader with its resources loaded once (`resources/ooxml/`: half
 * a megabyte of preset geometry and the built-in table styles, parsed on the
 * first deck — not at startup, where most sessions never open a `.pptx`).
 */
let resources: PptxResources | null = null;

function loadResources(): PptxResources {
  resources ??= {
    presets: parsePresetDefinitions(fs.readFileSync(path.join(ooxmlDir, "presetShapeDefinitions.xml"), "utf8")),
    tableStyles: parseTableStyles(fs.readFileSync(path.join(ooxmlDir, "tableStyles.xml"), "utf8")),
  };
  return resources;
}

/** `null` when the file can't be read as a presentation at all. */
export function readPptx(sourcePath: string): PptxDeck | null {
  try {
    return readPptxDeck(sourcePath, loadResources());
  } catch (error) {
    console.warn(`[slides] unreadable as a .pptx: ${sourcePath}: ${String(error)}`);
    return null;
  }
}
