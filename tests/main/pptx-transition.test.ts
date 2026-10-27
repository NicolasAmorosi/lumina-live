/**
 * How a `.pptx` slide enters, read from its own `p:transition` — the same
 * `SlideTransition` a legacy binary gives, so a hymn and an announcements deck
 * move the same way on the projector.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { strToU8, zipSync } from "fflate";
import { readPresentationMeta } from "../../src/main/slides/pptx-metadata";

const NS =
  'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" ' +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
  'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" ' +
  'xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main"';

let dir: string;

function writeDeck(transitions: string[]): string {
  const files: Record<string, Uint8Array> = {
    "ppt/presentation.xml": strToU8(
      `<p:presentation ${NS}><p:sldIdLst>${transitions
        .map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 1}"/>`)
        .join("")}</p:sldIdLst><p:sldSz cx="9144000" cy="6858000"/></p:presentation>`,
    ),
    "ppt/_rels/presentation.xml.rels": strToU8(
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${transitions
        .map(
          (_, i) =>
            `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i + 1}.xml"/>`,
        )
        .join("")}</Relationships>`,
    ),
  };
  transitions.forEach((transition, i) => {
    files[`ppt/slides/slide${i + 1}.xml`] = strToU8(
      `<p:sld ${NS}><p:cSld><p:spTree/></p:cSld>${transition}</p:sld>`,
    );
  });
  const file = path.join(dir, `deck-${transitions.length}-${Math.random().toString(36).slice(2)}.pptx`);
  fs.writeFileSync(file, zipSync(files));
  return file;
}

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "worship-pptx-transition-"));
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

test("each slide's transition, as PowerPoint and LibreOffice write it", () => {
  const meta = readPresentationMeta(
    writeDeck([
      // What LibreOffice exports for the hymnal's «Fade Smoothly», fast by default.
      `<p:transition advTm="10000"><p:fade/></p:transition>`,
      `<p:transition spd="slow"><p:fade thruBlk="1"/></p:transition>`,
      `<p:transition spd="med"><p:randomBar dir="vert"/></p:transition>`,
      `<p:transition><p:randomBar/></p:transition>`,
      // PowerPoint 2010+: the real one under mc:Choice, with its exact length.
      `<mc:AlternateContent><mc:Choice Requires="p14"><p:transition spd="slow" p14:dur="1250"><p14:vortex/></p:transition></mc:Choice><mc:Fallback><p:transition spd="slow"><p:fade/></p:transition></mc:Fallback></mc:AlternateContent>`,
      `<p:transition><p:cut/></p:transition>`,
      `<p:transition advTm="5000"/>`,
      "",
    ]),
  );
  expect(meta.slides.map((slide) => slide.transition)).toEqual([
    { style: "crossfade", durationMs: 500 },
    { style: "fade-through-black", durationMs: 1000 },
    { style: "random-bars-vertical", durationMs: 750 },
    { style: "random-bars-horizontal", durationMs: 500 },
    // Drawn as a crossfade of its own length — the owner's call for anything
    // we do not draw as itself.
    { style: "crossfade", durationMs: 1250 },
    null,
    null,
    null,
  ]);
});
