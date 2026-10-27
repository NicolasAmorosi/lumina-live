import fs from "node:fs";
import path from "node:path";
import { parentPort, workerData } from "node:worker_threads";
import { parsePresetDefinitions } from "./pptx/geometry";
import { readPptxDeck, type PptxResources } from "./pptx/reader";
import { parseTableStyles } from "./pptx/table-style";
import { readPresentationMeta, type PresentationMeta } from "./pptx-metadata";

/**
 * The `.pptx` reader, off the main thread. Reading a deck parses every slide's
 * XML twice (the model, then the timings and media), and a template whose map
 * slide is 22 MB of shapes took 11 s — on the thread that answers every IPC
 * call and serves `worship://`. Here it costs main nothing but the copy of the
 * result, which is why the layers come back as the JSON `deck_slides` stores.
 */
export type PptxRead = {
  width: number;
  height: number;
  slides: { hidden: boolean; layers: string }[];
  /** `null` when the timings and media couldn't be read: the slides still are. */
  meta: PresentationMeta | null;
};

export type PptxRequest = { id: number; file: string };
export type PptxReply = { id: number; read: PptxRead } | { id: number; error: string };

const ooxmlDir = (workerData as { ooxmlDir: string }).ooxmlDir;
let resources: PptxResources | null = null;

function read(file: string): PptxRead {
  // Loaded on the first deck, not at startup: most sessions never open a `.pptx`.
  resources ??= {
    presets: parsePresetDefinitions(fs.readFileSync(path.join(ooxmlDir, "presetShapeDefinitions.xml"), "utf8")),
    tableStyles: parseTableStyles(fs.readFileSync(path.join(ooxmlDir, "tableStyles.xml"), "utf8")),
  };
  const deck = readPptxDeck(file, resources);
  let meta: PresentationMeta | null = null;
  try {
    meta = readPresentationMeta(file);
  } catch {
    // The model is what's drawn; a deck without timings still projects.
  }
  return {
    width: deck.width,
    height: deck.height,
    slides: deck.slides.map((slide) => ({ hidden: slide.hidden, layers: JSON.stringify(slide.model) })),
    meta,
  };
}

parentPort?.on("message", ({ id, file }: PptxRequest) => {
  let reply: PptxReply;
  try {
    reply = { id, read: read(file) };
  } catch (error) {
    reply = { id, error: String(error) };
  }
  parentPort?.postMessage(reply);
});
