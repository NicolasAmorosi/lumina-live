/**
 * Where a `.pptx`'s sounds play: each on its own slide, for as many slides as
 * its media node says (`numSld`), counted among the slides the deck shows —
 * read from the file, never guessed from whether it loops.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { strToU8, zipSync } from "fflate";
import { placeAudio, readPresentationMeta, type AudioRef } from "../../src/main/slides/pptx-metadata";

const NS =
  'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" ' +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

let dir: string;
let audio: AudioRef[];

/** A slide with a sound on it (`p:pic` id 4) and the node that plays it. */
function soundSlide(node: string, hidden = false): string {
  return `<p:sld ${NS}${hidden ? ' show="0"' : ""}><p:cSld><p:spTree>
    <p:pic><p:nvPicPr><p:cNvPr id="4" name="Audio"/><p:cNvPicPr/><p:nvPr><a:audioFile r:link="rId2"/></p:nvPr></p:nvPicPr>
    <p:blipFill/><p:spPr/></p:pic></p:spTree></p:cSld>
    <p:timing><p:tnLst><p:par><p:cTn id="1"><p:childTnLst><p:audio>${node}</p:audio></p:childTnLst></p:cTn></p:par></p:tnLst></p:timing></p:sld>`;
}
const node = (attrs: string, cTn = '<p:cTn id="2"/>') => `<p:cMediaNode vol="80000"${attrs}>${cTn}<p:tgtEl><p:spTgt spid="4"/></p:tgtEl></p:cMediaNode>`;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "pptx-audio-"));
  const slides = [
    soundSlide(node(' numSld="2"')), // 1: two slides
    soundSlide(node(""), true), // 2: hidden — never plays
    soundSlide(node("", '<p:cTn id="2" repeatCount="indefinite"/>')), // 3: its slide, looping
    `<p:sld ${NS}><p:cSld><p:spTree/></p:cSld></p:sld>`, // 4
    soundSlide(node(' numSld="999"')), // 5: «play across slides»
  ];
  const files: Record<string, Uint8Array> = {
    "ppt/presentation.xml": strToU8(
      `<p:presentation ${NS}><p:sldIdLst>${slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 1}"/>`).join("")}</p:sldIdLst><p:sldSz cx="9144000" cy="6858000"/></p:presentation>`,
    ),
    "ppt/_rels/presentation.xml.rels": strToU8(
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${slides
        .map((_, i) => `<Relationship Id="rId${i + 1}" Type="${REL}/slide" Target="slides/slide${i + 1}.xml"/>`)
        .join("")}</Relationships>`,
    ),
  };
  slides.forEach((xml, i) => {
    files[`ppt/slides/slide${i + 1}.xml`] = strToU8(xml);
    files[`ppt/slides/_rels/slide${i + 1}.xml.rels`] = strToU8(
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="${REL}/audio" Target="../media/sound${i + 1}.mp3"/></Relationships>`,
    );
  });
  const file = path.join(dir, "sounds.pptx");
  fs.writeFileSync(file, zipSync(files));
  audio = readPresentationMeta(file).audio;
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

test("each sound says how many slides it plays across, and whether it loops", () => {
  expect(audio.map(({ startSlideIndex, slides, loop }) => [startSlideIndex, slides, loop])).toEqual([
    [1, 2, false],
    [2, 1, false],
    [3, 1, true],
    [5, 999, false],
  ]);
});

test("placed among the slides the deck shows: a hidden slide's sound never plays, and «across slides» runs to the end", () => {
  const visible = [1, 3, 4, 5];
  expect(audio.map((ref) => placeAudio(ref, visible))).toEqual([
    { startSlideIndex: 1, stopSlideIndex: 2, scope: "slide" },
    null,
    { startSlideIndex: 2, stopSlideIndex: 2, scope: "slide" },
    { startSlideIndex: 4, stopSlideIndex: null, scope: "deck" },
  ]);
});

test("when the slides and the file don't line up, every sound is the deck's music, as before", () => {
  expect(placeAudio(audio[2]!, null)).toEqual({ startSlideIndex: 1, stopSlideIndex: null, scope: "deck" });
});
