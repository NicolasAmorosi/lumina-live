/**
 * `containerKind` — the sniff that decides how much work converting a deck is.
 *
 * It is what routes a source file to one of three very different paths: parse
 * the OOXML directly, round-trip a legacy binary through `.pptx` first, or —
 * for a PDF — skip LibreOffice altogether and hand the file straight to the
 * rasterizer. Getting `pdf` wrong is not a cosmetic mistake: a PDF classified
 * as anything else goes through `soffice`, which imports it into Draw and
 * re-renders every glyph.
 *
 * Deliberately driven by the file's magic bytes rather than its extension, so
 * these tests give each fixture the *wrong* extension where that is the point.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { deckRequiresSoffice, ASSET_EXTENSIONS } from "../../src/shared/constants";
import { containerKind } from "../../src/main/slides/pptx-metadata";

let tmpDir: string;

function write(name: string, bytes: Uint8Array | Buffer): string {
  const file = path.join(tmpDir, name);
  fs.writeFileSync(file, bytes);
  return file;
}

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "worship-container-"));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("containerKind", () => {
  test("recognizes a PDF by its %PDF header", () => {
    const file = write("deck.pdf", Buffer.from("%PDF-1.7\n%\xb5\xb5\xb5\xb5\n1 0 obj\n", "latin1"));
    expect(containerKind(file)).toBe("pdf");
  });

  test("goes by the magic bytes, not the extension", () => {
    // Both directions: a PDF named like a presentation must still take the
    // no-LibreOffice path, and a real deck named `.pdf` must not be handed to
    // the rasterizer as one.
    const misnamedPdf = write("actually-a-pdf.pptx", Buffer.from("%PDF-1.4\n", "latin1"));
    expect(containerKind(misnamedPdf)).toBe("pdf");

    const misnamedDeck = write(
      "actually-a-deck.pdf",
      zipSync({ "ppt/presentation.xml": strToU8("<p:presentation/>") }),
    );
    expect(containerKind(misnamedDeck)).toBe("ooxml");
  });

  test("still classifies OOXML and legacy binaries", () => {
    const ooxml = write("deck.pptx", zipSync({ "ppt/presentation.xml": strToU8("<p:presentation/>") }));
    expect(containerKind(ooxml)).toBe("ooxml");

    // A `.pdf` is four bytes of ASCII and OLE2 is four bytes of binary — near
    // misses, so this pins that one is not read as the other.
    const ole2 = write("deck.pps", Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
    expect(containerKind(ole2)).toBe("binary");

    const odf = write("deck.odp", zipSync({ "content.xml": strToU8("<office/>") }));
    expect(containerKind(odf)).toBe("odf");
  });

  test("a file too short to sniff is unknown, not a crash", () => {
    expect(containerKind(write("empty.pptx", Buffer.alloc(0)))).toBe("unknown");
    expect(containerKind(path.join(tmpDir, "does-not-exist.pptx"))).toBe("unknown");
  });
});

describe("deckRequiresSoffice", () => {
  test("only a PDF converts without LibreOffice", () => {
    expect(deckRequiresSoffice("pdf")).toBe(false);
    for (const ext of ASSET_EXTENSIONS.ppt.filter((e) => e !== "pdf")) {
      expect(deckRequiresSoffice(ext)).toBe(true);
    }
  });

  test("accepts whatever shape the extension arrives in", () => {
    // `media_assets.ext` is stored bare and lowercased, but the callers are UI
    // code reading a DTO — a leading dot or an uppercase file name must not
    // silently put a PDF back behind the LibreOffice gate.
    expect(deckRequiresSoffice(".pdf")).toBe(false);
    expect(deckRequiresSoffice("PDF")).toBe(false);
    expect(deckRequiresSoffice(".PDF")).toBe(false);
  });

  test("a PDF is a deck, not a kind of its own", () => {
    // The whole design rests on this: everything downstream keys on
    // `kind === "ppt"` to mean "this is a deck".
    expect(ASSET_EXTENSIONS.ppt).toContain("pdf");
    expect(ASSET_EXTENSIONS.image).not.toContain("pdf");
  });
});
